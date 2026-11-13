# Deploying: migrations, health, CI

## How a change reaches production

1. A PR runs `.github/workflows/ci.yml`: typecheck + unit/pg tests; the
   migrations on a real Postgres 16 (the base branch's first, then this
   branch's, twice, then the built app's `/api/health`); and the Playwright
   suite against the live LiteAPI **sandbox** (`LITE_API_KEY` repo secret).
2. Merge to main. Vercel builds with `vercel-build` =
   `node scripts/migrate.mjs && next build`. On a **production** build the
   script applies `drizzle/` to `DATABASE_URL` first; a failed migration
   fails the build and the previous deployment keeps serving. On a preview
   build Vercel skips it: a preview's database is its PR's own Neon branch,
   migrated by the preview workflow (below), and an unmerged branch must
   never change production.
3. `.github/workflows/deployed.yml` runs `e2e/smoke.spec.ts` against the
   deployment: `/api/health`, a typed search, a picked-place search.
   Production fails the check; a preview only warns (a PR that adds a
   migration is expected to show it pending until merge). Previews are behind
   Vercel SSO and need `VERCEL_AUTOMATION_BYPASS_SECRET`; without it they are
   skipped with a notice.

Migrations must stay additive (`docs/onboarding.md`): the old deployment
serves for the seconds between the migration and the new one going live.

## Investigating a 500

- The user sees `… (Reference: 1a2b3c4d)`; the response body has `ref`.
- `vercel logs --project hotel-finder --query 1a2b3c4d` finds the line:
  `[api] 500 POST /hotels/api/session/brief ref=… vercel=… <what failed>`,
  then the stack.
- `SCHEMA DRIFT pg=42703|42P01|42704` means the database is behind the code.
  `curl https://www.feraltravels.com/hotels/api/health` names every missing
  table and column and how many migrations are not recorded. Fix:
  `DATABASE_URL=… npm run db:migrate` (or redeploy production).

## 2026-11-13: every typed search answered 500

- **What users saw:** the page loaded and place suggestions worked; pressing
  Enter on a sentence (or Find my hotel with words in the box) answered
  `500 {"error":"server_error"}`. Pill-only searches worked.
- **Cause:** migration `0005_tiresome_patch` (`usage_events.anon_id`, commit
  d87f462) was merged with PR #2 and deployed, but nothing applied migrations
  on deploy: they were applied once, by hand, by `setup-hosting.sh`. The
  production database stopped at 0004. Every model call writes a
  `usage_events` row naming `anon_id`, so the brief route threw
  `PostgresError 42703: column "anon_id" of relation "usage_events" does not
  exist`. Supplier calls write the same row but catch the failure (`[liteapi]
  usage meter failed`), so place lookups kept working and the ledger silently
  lost every supplier row since the deploy.
- **Why it was slow to see:** the 500 said `server_error` and nothing else;
  the log said `[api] unhandled` with no route or reference; no test ran on
  PRs, and no check ran against the deployment.
- **Reproduced** locally on Postgres 16 migrated to 0004 with `drizzle-kit
  migrate` (production's state): the brief route answered 500 with the same
  error; `scripts/migrate.mjs` applied exactly 0005 (it reads the records
  `drizzle-kit` wrote), and the same request answered 200. Also as a pg test:
  `src/test/pg/health.test.ts`.
- **Fixed by:** migrations on every production build (`scripts/migrate.mjs`);
  `/api/health`; a ref on every 500 and a log line that names the route, the
  SQLSTATE and, for drift, what to do; CI on every PR; the smoke spec after
  every deploy.


## Preview environments: one per PR, never the production database

**The problem (verified 2026-11-13).** Vercel's Git integration built a
Preview deployment for every pushed branch, and the Vercel project's Preview
environment held the same `DATABASE_URL` as Production (`setup-hosting.sh`
wrote both). Every preview read and wrote the production database; once a
build step applies migrations, a branch push would apply unmerged migrations
to production.

**Now:**

- `vercel.json` sets `git.deploymentEnabled` to `{ "main": true, "**": false }`:
  the Git integration deploys `main` (production) and nothing else. Vercel
  matches branch names with minimatch, `**` matches names with slashes, and a
  branch matching several rules deploys if any is `true`
  ([docs](https://vercel.com/docs/project-configuration/git-configuration)).
  Vercel reads `vercel.json` from the commit being pushed, so a branch cut
  before this file landed still gets a Git preview until it is rebased; the
  Vercel env change below is what makes those harmless.
- `.github/workflows/preview.yml`, on every PR to `main` (opened,
  synchronize, reopened; skipped when only `docs/**` or `*.md` changed; one
  run per PR, a new push cancels the old run):
  1. deletes and recreates the Neon branch `preview/pr-<N>` as a
     copy-on-write clone of production, expiring in 14 days as a backstop;
  2. applies this PR's migrations to it (`scripts/migrate.mjs` when the
     checkout has it, else `drizzle-kit migrate`): a rehearsal on
     production's real schema, journal and rows;
  3. **empties it** (`scripts/wipe-preview-db.mjs`: truncates every table in
     `public`, checks each is empty, leaves the `drizzle` journal) before any
     deployment exists. Fail closed: a failed wipe stops the job. The script
     refuses to run unless told the branch name twice and it is
     `preview/pr-<N>`;
  4. `vercel pull` (Preview env), overrides `DATABASE_URL` (the branch,
     pooled), `LITE_API_KEY` (the repo secret, which must start `sand_`, or
     the job fails) and `AUTH_SECRET` (random per run) in the build env, then
     `vercel build` and `vercel deploy --prebuilt` with the same three as
     `-e` runtime env for that deployment only. Never `--prod`;
  5. posts one sticky PR comment with `<url>/hotels` (deleted and reposted on
     each push so it is the newest), and deletes the PR's older previews,
     which point at the deleted branch.
- `.github/workflows/preview-cleanup.yml`, when the PR closes: deletes the
  Neon branch and every deployment `preview.yml` tagged with that PR
  (`--meta previewPr=<N>`) whose target is not production
  (`scripts/delete-pr-previews.sh`). It shares preview.yml's concurrency
  group, so closing cancels an in-flight preview first.
- `setup-hosting.sh` writes `DATABASE_URL` and `AUTH_SECRET` to the
  Production environment only.
- `src/lib/previewGuard.test.ts` holds all of the above: no preview workflow
  names a `DATABASE_URL` secret or deploys production; every `DATABASE_URL`
  in preview.yml comes from the branch the run created; migrate → wipe →
  build/deploy in that order, the wipe unskippable; the sandbox check before
  the build; `vercel.json`; `setup-hosting.sh`; both scripts' refusals (the
  sweep runs against a stubbed `curl`). Mutation-checked: 23 of 23 mutations
  caught.

Why each piece (lessons from Feral Travels' identical pipeline): no
production rows behind a URL running unreviewed code; wipe before the first
deploy, not after; a per-push branch so the rehearsal is against current
production; sweep old previews, or the plan's deployment storage fills (Feral
had 481); delete-and-repost the comment so the current link is never pages
up.

### One-time setup (Sam)

Nothing here was changed in Vercel, Neon or GitHub by the agent that wrote
this.

1. **Vercel, remove `DATABASE_URL` from the Preview environment** (Project
   `hotel-finder` → Settings → Environment Variables → `DATABASE_URL` → edit,
   untick Preview, keep Production). Also untick Preview on `AUTH_SECRET`
   (the workflow gives each preview its own). With it gone, a stray Git
   preview of an old branch fails with `DATABASE_URL is not set` instead of
   using production. Check: `npx vercel env ls preview --scope
   samuelshirleys-projects` lists neither.
2. **Vercel, check the Preview `LITE_API_KEY`** is not the production key.
   The workflow overrides it, but nothing else should be holding it there.
3. **GitHub repo secrets** (Settings → Secrets and variables → Actions):

   | Name | What | Where to get it |
   |---|---|---|
   | `VERCEL_TOKEN` | Vercel access token, scope `samuelshirleys-projects` | vercel.com → Account Settings → Tokens → Create |
   | `NEON_API_KEY` | Neon API key | console.neon.tech → Account settings → API keys (or a project-scoped key for `hotel-finder`); or install the Neon GitHub integration, which creates it |
   | `NEON_PROJECT_ID` | the `hotel-finder` project id (secret **or** repo variable) | Neon console → project → Settings → General, or `npx neonctl projects list` |
   | `LITE_API_KEY` | the LiteAPI **sandbox** key (`sand_…`); also used by `ci.yml` | LiteAPI dashboard, sandbox; the value in `.env` |

   `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are written in the workflows (they
   are identifiers, useless without the token). The production
   `DATABASE_URL` is deliberately not a GitHub secret. Until all four exist
   the preview job skips with a warning; with some missing it fails and names
   them.
4. The Neon project's default database and role must be `neondb` /
   `neondb_owner` (the create-branch-action defaults; `setup-hosting.sh`
   created it that way).

### Known limits

- **Not yet run in GitHub Actions.** The workflows pass `action-validator`;
  the wipe script was run against a local Postgres migrated by
  `drizzle-kit` (18 tables emptied, journal kept, migrations still a no-op
  afterwards); the sweep's selection was run against a stubbed API. Not
  exercised: the Neon actions' outputs, `vercel build` / `deploy -e` on
  this project, the comment, the real Vercel deployments API.
- **The branch inherits production's role password.** Neon copies roles to a
  child branch, so the preview's connection string holds the same password
  as production's, on a different host. It is server-only env on a deployment
  only non-fork PRs get. Resetting the role's password on the branch would
  remove that; not done.
- Previews made by the Git integration before this landed carry no
  `previewPr` meta and are not swept; delete them by hand.
- A preview is a production build: `NODE_ENV=production`, Resend and the
  model keys from the Preview environment, spend caps as configured.

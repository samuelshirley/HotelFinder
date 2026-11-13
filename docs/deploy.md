# Deploying

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

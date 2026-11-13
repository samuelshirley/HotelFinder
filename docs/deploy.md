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
   build it does nothing: previews share the production database
   (`setup-hosting.sh` sets `DATABASE_URL` for both), and an unmerged branch
   must never change it.
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

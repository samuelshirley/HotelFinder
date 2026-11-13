# Testing: the end-to-end framework

Unit and pg tests (`npm run test`) are described next to the code they test.
This page is the Playwright suite in `e2e/`: what it covers, how it is laid
out, how to run it locally and per shard, and the measurements behind its
parallel settings.

## What it holds the app to

- **Every control is tested.** `e2e/guards/controls.spec.ts` walks each page
  through its states, lists every button, link, tab, input, select, summary and
  focusable separator on screen, and fails on any control that no claim in
  `e2e/guards/registry.ts` matches. Each claim names the test that presses it;
  a claim whose test does not exist fails too. A new button breaks CI until a
  test exercises it and a claim says so.
- **Every API route is tested.** `e2e/api/coverage.spec.ts` reads
  `src/app/api/**/route.ts`, and fails if a route or a method is not in
  `e2e/api/catalog.ts`, or if its spec has no `test.describe('<METHOD>
  /api/<route>')`. It also sweeps every route at once: a method it does not
  export answers 405; a POST body that is not JSON or not the route's one
  schema answers 400 `invalid_request`.
- **Every page is clean.** An automatic fixture (`e2e/support/diagnostics.ts`)
  fails any test that saw a console error, a page error, a failed request, an
  unexpected 4xx/5xx, or a 500 from our API without its `ref`. Tests that cause
  an error on purpose declare it with `diagnostics.allow(url, status, reason)`.
  Shared matchers check that images load and have a text alternative
  (`toHaveLoadedImages`), links resolve or are https (`toHaveWorkingLinks`), and
  alerts say only the copy in `src/lib/errors.ts` (`toHaveOnlyErrorCopy`).
- **Intended behaviour, not current output.** Assertions come from the docs,
  `src/lib/errors.ts` (imported, never retyped), the components' stated
  purpose and the obvious UX intent. A test that fails because the app is wrong
  stays failing until the app is fixed: no `test.fail`, `skip` or `fixme`, and
  no snapshot of wrong output. Live supplier data (names, prices) is checked for
  format and invariants (a currency amount, total = per night × nights rounded
  up, a reason on every card, public prices only for a visitor), never for
  fixed values. No pixel snapshots: macOS and Linux render differently.

## Layout

```
playwright.config.ts      dev server per run, fresh PGlite, AI and email keys blanked, tags, workers
e2e/
  global-setup.ts         compiles every page and API route once before workers start
  fixtures/test.ts        the `test` every spec imports: per-test visitor (cookies + own client IP),
                          `api`, automatic `diagnostics`, and state fixtures:
                          searched · signedIn · admin · prebooked · booked (cancelled at teardown)
  pages/app.ts            page objects for /hotels: TripBox, Calendar, Party, Results, Card, Chat,
                          Sidebar, Detail; expectNotCovered()
  pages/checkout.ts       CheckoutPage (/hotels/book/[id]) and AdminPage (/hotels/admin)
  support/api.ts          the API client: one method per route; json(), expectError(), patient()
  support/schemas.ts      strict Zod shapes of every API answer (unknown keys fail: invariant 6)
  support/matchers.ts     toHaveLoadedImages, toHaveWorkingLinks, toHaveOnlyErrorCopy
  support/diagnostics.ts  console/page errors, failed requests, refless 500s
  support/inventory.ts    every interactive control on screen, as `role "name"`
  support/copy.ts         ERROR_COPY (from src/lib/errors.ts) and the pages' intended copy
  support/dates.ts        calendar arithmetic; the canonical stay (Porto, the weekend after next)
  support/money.ts        money as printed, parsed to minor units
  support/env.ts          base URL, admin emails, unique emails, the e2e CRON_SECRET
  smoke.spec.ts           @smoke: health, a typed search, a picked-place search
  ui/first-screen.spec.ts the trip box, pills, calendar, party, priorities, example
  ui/onboarding.spec.ts   the questions in the chat (which place, nights, party, priorities)
  ui/results.spec.ts      cards, header chips and their editors, trips list, resize, narrow layout
  ui/detail.spec.ts       the hotel opened: slide-out and expanded, every module and control
  ui/map.spec.ts          pins, hover/select, zoom, credits, recentre, search around, measure from
  ui/chat.spec.ts         typed messages on the no-model path (@ai: the model's own answers)
  ui/booking.spec.ts      checkout, code sign-in, test wallets, receipt, cancel, error states
  ui/admin.spec.ts        sign-in gate, 404 for non-admins, cost overview, one search's ledger
  ui/saved.spec.ts        the heart (cards, detail, full list), the saved list, the currency chip
  ui/filters.spec.ts      star class, guest rating, kind of place, brand; Cancel and Escape
  ui/full-list.spec.ts    "Show all N hotels": order, compact cards, map frame, pager, Try again
  ui/freeze.spec.ts       Deal Freeze through the UI: freeze, confirm, release; the frozen page
  ui/rooms.spec.ts        room splits ("Best price"): each card's rooms, re-checked at checkout
  ui/checkout-extras.spec.ts  hotel FAQ, pay now / at the hotel, special request on the receipt
  ui/spanish.spec.ts      the language picker and a search in Spanish
  ui/errors.spec.ts       each error code's copy on the page, refs, no-JSON 5xx, no network
  content/pages.spec.ts   every page: lang, title, icon, images, links, alerts, 404, root redirect
  api/*.spec.ts           one describe per "<METHOD> /api/<route>"; catalog.ts; coverage.spec.ts
                          (freeze.spec.ts: freeze, keep, release and the sweep; saved.spec.ts;
                          hotels.spec.ts: the full list's pages)
  guards/                 controls.spec.ts (the sweep) and registry.ts (the claims)
```

### Tags

| Tag | What | Default run |
|---|---|---|
| `@smoke` | read-only (one search at most): safe against production | yes; the only tag `deployed.yml` runs |
| `@api` | API contract tests | yes |
| `@ui` | the UI, through a real browser | yes |
| `@content` | copy, images, links | yes |
| `@booking` | real sandbox bookings, each cancelled | yes |
| `@admin` | the admin pages | yes |
| `@coverage` | the two guards | yes |
| `@freeze` | Deal Freeze: real sandbox bookings, each released or cancelled | yes |
| `@ai` | needs the real model (Anthropic/Jev): spends money | only with `E2E_AI=1` |

## Running it

```bash
npx playwright test                       # everything but @ai; starts its own dev server on :3322
npm run e2e:smoke | e2e:api | e2e:ui      # by tag
npx playwright test e2e/ui/map.spec.ts    # one file
E2E_WORKERS=1 npx playwright test         # one worker
npx playwright test --shard=2/3           # what one CI shard runs
E2E_AI=1 npx playwright test --grep @ai   # the model's own answers (costs money)
E2E_BASE_URL=https://www.feraltravels.com npx playwright test   # @smoke against a deployment
npm run e2e:report                        # the last HTML report
```

The server it starts: `next dev` into `.next-e2e`, a fresh embedded PGlite per
run (`HOTEL_FINDER_DATA_DIR`), `DATABASE_URL` blanked (or `E2E_DATABASE_URL`),
`JEV_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_ADMIN_KEY` and `RESEND_API_KEY`
blanked, `CRON_SECRET` set to a test value (so the Deal Freeze sweep can be
called; `e2e/support/env.ts`) (Next does not override a variable already set, so `''` wins over
`.env`), and `ADMIN_EMAILS` set to the test admins. `LITE_API_KEY` comes from
`.env` locally and the repository secret in CI: it must be a **sandbox** key.

Why `next dev` and not `next build && next start`: a production build refuses
the embedded database (`DATABASE_URL` is required in production) and never
returns a sign-in code without an email service, so the checkout and admin
sign-ins could not be tested. A Postgres per shard would fix the first, not the
second.

### Writing a test

- Import `test` and `expect` from `e2e/fixtures/test.ts`, never from
  `@playwright/test`.
- Locate by role and accessible name (`getByRole`, `getByLabel`), through the
  page objects; never by CSS class (a designer restyles `src/` freely).
- Need a search? Use the `searched` fixture (made through the API, opened with
  `openSession(page, id)`): it is the canonical stay, so the sandbox answers it
  from its cache. Need the UI path itself? Drive it (see first-screen.spec.ts).
- Something the sandbox cannot produce on demand (a stale price, a failed
  booking, a 500): answer the page's own request with `page.route` and say so
  in the test. Allow the error you cause with `diagnostics.allow`.
- A new control: write the test that presses it, then add its claim in
  `e2e/guards/registry.ts`. A new route: add it to `e2e/api/catalog.ts` and a
  `test.describe('<METHOD> /api/<route>')` to its spec.

## Isolation and the sandbox's rate limit

- **Each test is its own visitor**: its own cookies, and its own client IP
  (`x-forwarded-for`, set only on requests to our origin so third-party map
  tiles and photos get no CORS preflight). The app's per-IP limits (`rateLimit`
  in `src/server/http.ts`) key on that header, so parallel workers never share
  a bucket, and the rate-limit tests get a fresh one.
- **The LiteAPI sandbox has its own limit** (about 5 requests a second per key,
  docs/architecture.md §12), shared by every worker and every shard. Measured:
  8 different searches at once → 3 refused ("The hotel search did not
  answer"); 8 identical searches at once → none refused, answered in 0.2 s from
  the sandbox's cache. So most tests search the **canonical stay** (Porto, the
  weekend after next, 2 adults), and setup fixtures (`api.search`,
  `api.patient`) retry a refusal up to three times. A test of the search
  itself never retries. A 503 `supplier_unavailable` seen by a page is reported
  as a `sandbox-busy` annotation, not a failure: the test's own assertions fail
  if the page did not cope.
- Every booking is made in the sandbox with its test card method and cancelled
  before the test ends (the `booked` fixture cancels at teardown).

## Parallel runs: measured

Measured 2026-11-13 on an Apple Silicon Mac (local `next dev`, embedded
PGlite, live sandbox), 207–208 tests. Wall time includes the server start and
the route warm-up (`global-setup`: all routes compiled in 4.6–5.8 s).

| Workers | Wall | Notes |
|---|---|---|
| 1 | 9.4 min | baseline; 1 test saw the sandbox busy |
| 3 | 4.9 min, then 3.8 min | first with a 30 s expect timeout, then 15 s (the default now); 2–3 tests saw the sandbox busy |
| 5 | 3.0 min | 4 tests saw the sandbox busy (all coped: setup retried); 1 setup that searched a non-canonical party was refused |

After main's PR #4 (Deal Freeze, saved hotels, filters, the full list, room
splits, currency, Spanish) was merged in: **259 tests, 3 workers, 5.0–5.5 min**
locally (two runs, 2026-11-13). The new time is mostly Deal Freeze: each
freeze is a real sandbox booking (and its release a real cancel), and the
freeze limit test makes four. Three shards in CI still fit the same budget.

(The failing tests in those runs are app bugs; each spends its full expect
timeout, about 15 s, before failing. With them fixed the runs get shorter.)

- **One dev server and one embedded database take five workers.** No server
  error, no PGlite contention seen at 5: the database is in-process and the
  requests are short. `next dev` compiling on demand was the one risk; the
  warm-up removes it.
- **The limit is the sandbox, not the server.** Measured directly: 8 different
  searches at once → 3 refused; 8 identical → none. At 5 workers, 4 of 208
  tests had a 503 `supplier_unavailable` from the sandbox; setup retries
  absorbed them.
- **So: 3 workers locally, and in CI 3 shards × 2 workers** (6 concurrent, as
  measured safe at 5 locally plus the canonical-stay cache). Each shard pays a
  fixed ~2 min (npm ci, browser, server start, warm-up) for ~70 tests at 2
  workers (~1.5–3 min on a 4-vCPU runner): about 4–5 min per PR against ~7–9
  for one job. More shards add fixed cost and sandbox concurrency for little
  gain; if the suite doubles, go to 4 shards before raising workers.
- `next build && next start` was not used: see "Running it" (production mode
  refuses the embedded database and never shows a sign-in code).

CI (`.github/workflows/ci.yml`): job `e2e` is the matrix (`shard: [1, 2, 3]`,
`E2E_WORKERS=2`, blob reporter); job `e2e-report` (named "Playwright (live
LiteAPI sandbox)", the check branch protection requires) merges the blobs into
one HTML report artifact (`playwright-report`) and fails unless every shard
passed. A fork's PR has no `LITE_API_KEY`: every shard skips with a warning and
the report job passes with a notice. `checks` and `migrations` are unchanged.
`deployed.yml` is unchanged: with `E2E_BASE_URL` the config runs only `@smoke`.

## Guards: mutation-checked

Each guard was made to fail on purpose, then restored (2026-11-13):

| Guard | Mutation | Result |
|---|---|---|
| API coverage | a new `src/app/api/zz-new/route.ts` (GET), in a copy of the API folder (`E2E_API_DIR`) | fails: "has no entry in e2e/api/catalog.ts" |
| API coverage | `DELETE` added to `me/route.ts` (same copy) | fails: "the route exports DELETE, GET, the catalog says GET" |
| API coverage | the describe `'GET /api/health'` renamed | fails: "has no test.describe('GET /api/health', …)" |
| Controls | a `<button>Surprise feature</button>` added to the first screen | fails: `button "Surprise feature" (seen in: first screen)` |
| Controls | the Zoom claim removed | fails: `button "Zoom in"`, `button "Zoom out"` unclaimed |
| Controls | a claim pointed at a test that does not exist | fails: "no test titled … in ui/detail.spec.ts" |
| Images and links | a broken `<img>`, an `<img>` with no `alt`, a link to a missing page and one outside `/hotels`, a `console.error` | each reported (`toHaveLoadedImages`, `toHaveWorkingLinks`, diagnostics) |

To repeat the API ones without touching `src/`: copy `src/app/api` somewhere,
change the copy, and run `E2E_API_DIR=<copy> npx playwright test
e2e/api/coverage.spec.ts -g "every route file"`. `E2E_ALL=1
E2E_BASE_URL=http://localhost:3000` runs the suite against a dev server you
already have up, without starting one.

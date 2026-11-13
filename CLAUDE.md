# CLAUDE.md — hotel finder

> **For AI assistants:** this is a **map**, not a manual: where things are and
> what you must not break. Every "why", measurement and postmortem goes in
> `docs/<area>.md`, with at most one line here pointing at it. Once
> `src/lib/claudeMdGuard.test.ts` exists (build step 10) this file is guarded
> at 28 KB and machine-checked to list every API route, table, tool, script
> and e2e spec.

## Status

**It runs locally: `scripts/dev.sh`, at `localhost:3000/hotels`.** Served at
**feraltravels.com/hotels**: every browser-side URL goes through `withBase`
(`lib/basePath.ts`), guarded by `basePathGuard`. What works, what is not built and what
has never been verified: **`docs/build-log.md`**. Read that first.
Every PR gets its own preview (own Neon branch, emptied; sandbox key):
`.github/workflows/preview.yml`, `docs/deploy.md`.

## Scope — hold the line

A chat that finds the right hotel for your dates, budget and must-haves, shows
the best few with real prices and the reason each was picked, and takes payment
in the chat. Anything beyond that is flagged before it is built: flights,
packages, loyalty, written reviews, price alerts, group bookings, saved cards,
a second supplier, a native app. Full design, decisions and open questions:
**`docs/architecture.md`**.

## Stack

Next.js 14 (App Router, React 18) · TypeScript · Neon Postgres via `postgres`
+ Drizzle · Zod · NextAuth v5 (email OTP, no passwords) · Resend · Anthropic
SDK (Haiku 5.5, ids in one registry) · **Jev** (typed-decision server, asked
first on every message) · **LiteAPI** (the only supplier) · MapLibre + OpenFreeMap
tiles (no key; `docs/design/map.md`) · Vitest, PGlite, Playwright · Vercel.

## Who does what

- **Jev router**: first responder. Picks the tier and the intent from labels
  we supply; code extracts every value. Settles only what it is confident
  about; never refuses a user; never books without the user's confirmation.
  Also answers questions about what is on screen (a hotel's price, terms,
  rating, facilities; which is cheapest; what the search is set to) from the
  rows, by template: `docs/jev-expansion.md`.
- **Haiku agent**: everything Jev does not settle, plus the one forced-tool
  intent scan that extracts a new search from free text.
- **Stay finder**: deterministic, server-side. The only thing that creates
  shortlist rows.
- **Store**: session state in Postgres, a closed union of typed actions, pure
  reducers, one dispatch path used by both producers.

## Commands

```bash
scripts/dev.sh           # run locally; embedded Postgres in .data/, no setup
npm run test             # vitest: unit + pg (in-process PGlite, no network)
npm run typecheck        # tsc --noEmit
npx playwright test      # real browser, own dev server, live LiteAPI sandbox
npm run db:generate      # after editing schema.ts; a test fails if you forget
scripts/jev-live.sh      # ask the real Jev 46 messages (46 of 46 on 2026-11-12)
```

## Layout

```
src/
  app/            page.tsx + api/ (each route: one Zod payload)
  components/     App, ChatPanel, FormControl, ResultsPanel, MapPanel, DetailSheet, api.ts
  lib/            PURE logic, unit-tested
    store/        actions (closed Zod union), reducers, fingerprint
    router/       catalogue (Jev's questions), slots (code extracts values), route
    finder/       rank, geo, candidates, personas — docs/finder.md
    replies.ts    fixed lines for changes and answers made without a model
    answers.ts    a question about what is on screen → typed values from the rows
    reasonText.ts words for a ranking reason
    mapView.ts    the map's pure half: pins, label layout, camera frame, ring
    stagedPlan.ts a yes with no model call; turnBudget.ts the 280 s stop
    errors.ts     every error code and its copy
    amenities.ts pricing.ts money.ts bookingStates.ts pgErrors.ts
  server/
    db/           schema.ts, client.ts (Postgres, or embedded PGlite in dev)
    repos/        the ONLY way to touch the DB
    finder.ts     fetch → rank → shortlist; the only writer of finder rows
    dispatch.ts   the one path every change takes
    onboarding.ts the form-in-chat; turn.ts one chat turn; view.ts; http.ts
    supplier/     BOUNDED — index.ts + types.ts are the only public surface
    jev/          BOUNDED — index.ts is the only public surface
    agent/        BOUNDED — index.ts is the only public surface; the only
                  importer of the Anthropic SDK (docs/agent.md)
    spend.ts      the 24-hour caps checked before every model call
    breakers.ts   kill switch + flood breaker before a turn: 503 circuit_open, fail closed
    propertyDetails.ts  one hotel's listing as plain text
    auth/anon.ts  the signed anonymous cookie
  test/pg/        PGlite harness, recorded supplier, repo and turn tests
e2e/              Playwright
drizzle/          generated migrations
docs/             every "why"
```

### API routes

```
api/places  api/session (POST new, GET this visitor's trips)  api/session/[id]  api/session/[id]/form
api/session/[id]/property/[propertyId]  api/session/[id]/turn
api/session/[id]/turns  api/auth/verify (sign in with a code outside checkout)
```

Pages (all under `/hotels`): `/` (the app), `/book/[id]`, `/admin` + `/admin/search/[id]` (cost per
search; `ADMIN_EMAILS` only, sign-in form otherwise, 404 to non-admins):
`docs/usage.md`.

### Schema (18 tables in `src/server/db/schema.ts`)

Rules each table carries, and what broke while building them:
**`docs/schema.md`**.

users, accounts, sessions, verificationTokens, emailOtpCodes, searchSessions,
stays, agentTurns, chatHistory, properties, offers, shortlistEntries,
userPreferences, bookings, usageEvents, appMeta, ipRequestCounters, ideas

### Repos (`src/server/repos/`)

sessions, chat, turns, properties, offers, shortlist, finderShortlist (FINDER
ONLY), usage, ideas, costs (admin read-only cost views), preferences, bookings, appMeta, rateLimit

### Guard tests

`schemaGuard` · `supplierBoundaryGuard` · `fixturesGuard` ·
`shortlistSourceGuard` · `agentBoundaryGuard` (SDK, key and model ids each
in one place) · `errorCopyGuard` (every error code has copy; no
empty catch) · `basePathGuard` (no root path in a fetch, href, src or
navigation; `<Link>` exempt, never wrapped in withBase) · `meterGuard` (only
five server files call out, each writes the usage ledger; every supplier op
priced in `lib/supplierPrices.ts`: `docs/usage.md`) · `mapPointGuard` (a map
point enters only from the map: `docs/design/map.md`) · `devDatabase` (migrations build exactly the schema) · `previewGuard`
(a preview never reaches the production database: `docs/deploy.md`). Mutation
logs: `docs/schema.md`, `docs/supplier.md`, `docs/finder.md`, `docs/deploy.md`.

### Agent tools (`src/server/agent/tools.ts`)

resolve_place, hotel_details (lookups) · set_destination, set_dates,
set_guests, set_price_cap, set_priority, require, stop_requiring, set_aside,
show_others, bring_back_all (each becomes typed actions) · open_hotel,
show_map, mark_on_map (the screen only) · hold_for_confirmation (stage the
queued changes for a yes) · submit_idea.
The agent names a hotel by position and a place by a ref from this turn's
lookup; it never sees an id or writes a price. Rules: `docs/agent.md`.

### Scripts (`scripts/`)

capture-liteapi-fixtures.mjs (`docs/supplier.md`), dev.sh, jev-live.sh,
agent-live.sh (14 real cases against Anthropic; prints the cost),
setup-hosting.sh (one-time Neon + Vercel setup; secrets read from .env,
Neon URL kept in .env.neon so dev stays on embedded Postgres; production
env only for DATABASE_URL and AUTH_SECRET), wipe-preview-db.mjs and
delete-pr-previews.sh (run by the preview workflows: `docs/deploy.md`)

### Agent tooling

Neon agent skill in `.claude/skills/neon/` (pinned in `skills-lock.json`;
`npx neon skills status` / `update -y`) and the Neon MCP server in
`.mcp.json` (OAuth: URL only, sign-in on first use, no key in the repo), and
the Playwright MCP (`@playwright/mcp`): drive the real app with it first when
building or diagnosing e2e work.
Do not run `neon link`/`checkout`: they pull `DATABASE_URL` into `.env`,
which would point dev at Neon. The Neon URL lives in `.env.neon`.

### E2E specs (`e2e/`)

search, book, admin, map

## Lockdown invariants (load-bearing)

The full list of 19 with the reason for each: `docs/architecture.md` §14.
The ones most easily broken:

- Every API route accepts ONE Zod schema. Free text is interpreted only at the
  intent-scan boundary.
- All DB access goes through `src/server/repos/`.
- An answer given without a model is a template over row values. A value the
  row does not hold is said as "the listing does not say"; no facility list
  is unknown, never "no" (`lib/answers.ts`).
- The model converts; it does not author. Jev and Haiku emit typed actions
  only. No price, fee, tax, cancellation term or availability claim in prose.
- Shortlist rows come only from the finder. Supplier ids are opaque.
- A member-priced offer never reaches an anonymous session.
- A rate is re-checked before any payment form; a changed rate is shown.
- **The supplier's book call is not idempotent.** Call it only after winning
  the `paid → booking` claim, and never retry it: `docs/supplier.md`.
- Card data never reaches our server.
- `JEV_BASE_URL` is server-only and a privacy boundary.
- A preview never reaches the production database, and no production row
  sits behind a preview URL (`previewGuard`, `docs/deploy.md`).

## Working rules

- Commit finished, scoped work after `tsc --noEmit` and the unit tests pass.
  Run the unit tests after every code change. Claude may push to `main`
  (repo: github.com/samuelshirley/HotelFinder, public); Sam merges PRs.
- Reproduce, never guess. If it cannot be reproduced, say so.
- Supplier payloads in tests are recorded from the sandbox, never hand-written.
- Mutation-check every new guard test.
- Never trim test coverage to save time or spend; measure and present.

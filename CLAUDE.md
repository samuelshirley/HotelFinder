# CLAUDE.md — hotel finder

> **For AI assistants:** this is a **map**, not a manual: where things are and
> what you must not break. Every "why", measurement and postmortem goes in
> `docs/<area>.md`, with at most one line here pointing at it. Once
> `src/lib/claudeMdGuard.test.ts` exists (build step 10) this file is guarded
> at 28 KB and machine-checked to list every API route, table, tool, script
> and e2e spec.

## Status

**2026-11-11: build steps 2 and 3 of 11 done** (schema, repos, PGlite tests;
LiteAPI adapter on recorded fixtures). No routes, no UI, no finder, no agent yet. Lines under "Planned layout"
that do not exist yet are marked *(planned)*.

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
SDK (Haiku 4.5, ids in one registry) · **Jev** (typed-decision server, asked
first on every message) · **LiteAPI** (the only supplier) · Google Maps/Places
(paid) · Vitest, PGlite, Playwright · Vercel.

## Who does what

- **Jev router**: first responder. Picks the tier and the intent from labels
  we supply; code extracts every value. Settles only what it is confident
  about; never refuses a user; never books without the user's confirmation.
- **Haiku agent**: everything Jev does not settle, plus the one forced-tool
  intent scan that extracts a new search from free text.
- **Stay finder**: deterministic, server-side. The only thing that creates
  shortlist rows.
- **Store**: session state in Postgres, a closed union of typed actions, pure
  reducers, one dispatch path used by both producers.

## Commands

```bash
npm run test         # vitest: unit + pg (in-process PGlite, no network)
npm run typecheck    # tsc --noEmit
npm run db:generate  # drizzle-kit generate
node scripts/capture-liteapi-fixtures.mjs   # re-record sandbox fixtures
```

`npm install` needs `legacy-peer-deps` (set in `.npmrc`): `docs/schema.md`.

## Layout

```
src/
  lib/            PURE logic, unit-tested
    bookingStates.ts   booking transition map (incl. the `booking` claim)
    money.ts           supplier decimals → integer minor units
    pgErrors.ts        unique-violation reader
    store/ finder/ agent/ router/      (planned)
  server/
    db/           schema.ts (all tables), client.ts (lazy, DATABASE_URL)
    repos/        the ONLY way to touch the DB
    supplier/     BOUNDED — index.ts + types.ts are the only public surface
      liteapi/    http, schemas, normalize, adapter, __fixtures__ (recorded)
    jev/ payments/ auth/               (planned, each BOUNDED)
  test/pg/        PGlite harness, fixtures, repo round trips
  app/ components/                     (planned)
e2e/                                   (planned)
docs/             every "why"
```

### API routes

None yet.

### Schema (18 tables in `src/server/db/schema.ts`)

Rules each table carries, and what broke while building them:
**`docs/schema.md`**.

users, accounts, sessions, verificationTokens, emailOtpCodes, searchSessions,
stays, agentTurns, chatHistory, properties, offers, shortlistEntries,
userPreferences, bookings, usageEvents, appMeta, ipRequestCounters, ideas

### Repos (`src/server/repos/`)

sessions, chat, turns, properties, offers, shortlist, finderShortlist (FINDER
ONLY), usage, preferences, bookings, appMeta

### Guard tests

`schemaGuard` (timestamps through `ts()`, stay dates are `date`, money is
integer) · `supplierBoundaryGuard` (nothing outside `supplier/` imports past
its index and types; the adapter never books with the account card) ·
`fixturesGuard` (fixtures match their captured hash and hold no key or
secret). Mutation logs: `docs/schema.md`, `docs/supplier.md`.

### Agent tools

None yet.

### Scripts (`scripts/`)

capture-liteapi-fixtures.mjs — what it records and why: `docs/supplier.md`.

### E2E specs

None yet.

## Lockdown invariants (load-bearing)

The full list of 19 with the reason for each: `docs/architecture.md` §14.
The ones most easily broken:

- Every API route accepts ONE Zod schema. Free text is interpreted only at the
  intent-scan boundary.
- All DB access goes through `src/server/repos/`.
- The model converts; it does not author. Jev and Haiku emit typed actions
  only. No price, fee, tax, cancellation term or availability claim in prose.
- Shortlist rows come only from the finder. Supplier ids are opaque.
- A member-priced offer never reaches an anonymous session.
- A rate is re-checked before any payment form; a changed rate is shown.
- **The supplier's book call is not idempotent.** Call it only after winning
  the `paid → booking` claim, and never retry it: `docs/supplier.md`.
- Card data never reaches our server.
- `JEV_BASE_URL` is server-only and a privacy boundary.

## Working rules

- Commit finished, scoped work after `tsc --noEmit` and the unit tests pass.
  Run the unit tests after every code change. Sam pushes and merges.
- Reproduce, never guess. If it cannot be reproduced, say so.
- Supplier payloads in tests are recorded from the sandbox, never hand-written.
- Mutation-check every new guard test.
- Never trim test coverage to save time or spend; measure and present.

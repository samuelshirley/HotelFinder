# CLAUDE.md — hotel finder

> **For AI assistants:** this is a **map**, not a manual: where things are and
> what you must not break. Every "why", measurement and postmortem goes in
> `docs/<area>.md`, with at most one line here pointing at it. Once
> `src/lib/claudeMdGuard.test.ts` exists (build step 10) this file is guarded
> at 28 KB and machine-checked to list every API route, table, tool, script
> and e2e spec.

## Status

**2026-11-11: no code yet.** The repo holds this map, `docs/architecture.md`,
`.env.example` and `.gitignore`. Everything under "Planned" is a plan, not a
fact; move a line out of "Planned" only when the thing exists.

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

## Planned layout

```
src/
  app/            pages + api/ routes (one Zod payload each)
  components/     ChatPanel, ResultsPanel, OfferCard, OfferDetail, StayMap,
                  form rows (chips, OTP, payment)
  lib/            PURE logic, unit-tested
    store/        actions, reducers, staged action
    finder/       normalize, filter, rank, reasons
    agent/        context, tools/, reply guards
    router/       intent catalogue, slot extraction, settle test
  server/
    db/           schema.ts, client.ts
    repos/        the ONLY way to touch the DB
    supplier/     adapter interface + liteapi/ (BOUNDED)
    jev/          BOUNDED — index.ts is the only public surface
    payments/     BOUNDED — canBook(userId) is the only public question
    auth/         guards, OTP, session store
e2e/              Playwright specs
docs/             every "why"
```

### API routes

None yet.

### Schema

None yet.

### Agent tools

None yet.

### Scripts

None yet.

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
- Card data never reaches our server.
- `JEV_BASE_URL` is server-only and a privacy boundary.

## Working rules

- Commit finished, scoped work after `tsc --noEmit` and the unit tests pass.
  Run the unit tests after every code change. Sam pushes and merges.
- Reproduce, never guess. If it cannot be reproduced, say so.
- Supplier payloads in tests are recorded from the sandbox, never hand-written.
- Mutation-check every new guard test.
- Never trim test coverage to save time or spend; measure and present.

# Build log

Where the build stands. Updated at every commit so a resumed session can
pick up from the first unfinished step.

| Step | What | State |
|---|---|---|
| 1 | Architecture note, CLAUDE.md | done |
| 2 | Schema, repos, PGlite tests | done |
| 3 | LiteAPI adapter on recorded fixtures | done |
| 4 | Stay finder, 20 personas | done |
| 5 | Store: actions, reducers, dispatch | done |
| 6 | Jev module and router | built; **never run against the real Jev** |
| 7 | Turn route: durable turns, SSE, drain, reconcile | done, without the Haiku agent |
| 8 | Form-in-chat onboarding | done; no intent scan (needs Anthropic) |
| 9 | UI: chat, results panel, detail sheet | done; no map |
| 10 | Guards, e2e | guards done; one Playwright flow, no OTP (no sign-in yet) |
| 11 | Cost measurement | not started |

**Milestone reached 2026-11-11: it runs locally.** `scripts/dev.sh`, then
http://localhost:3000.

## What works end to end (verified in a real browser against the live sandbox)

Five-question form → first search → five ranked cards with a reason, total,
per-night, pay-at-hotel and cancellation line → detail sheet → reload keeps
the search → new search. `e2e/search.spec.ts`.

## What is not built

- **The Haiku agent and the intent scan.** No `ANTHROPIC_API_KEY`. A message
  the router will not settle gets a fixed line saying so. Changing the
  destination or giving new dates by message therefore does not work yet;
  "New search" does.
- **Sign-in (OTP), member prices, booking and the payment row.** The Book
  button is disabled and says so. Every visitor is anonymous and sees public
  prices.
- **Staged yes, spend caps and breakers, the 280 s turn budget, reply guards.**
  Per-IP request limits exist.
- **Map.** Needs a decision on Google Maps (paid) versus MapLibre.
- **Cost measurement** (step 11) and the persona-driven simulated users.

## Not verified

- **Jev, live.** The build session was not permitted to call
  api.typesafe.ai (blocked three times by its tool-permission layer). The
  module follows TypeSafe's documented response shape and Feral's adapter.
  `scripts/jev-live.sh` asks the real Jev twelve typical messages and checks
  each decision; it has not been run.
- **macOS.** Everything ran in a Linux VM on this folder. `scripts/dev.sh`
  reinstalls node_modules for the Mac before starting.

## Notes for whoever resumes

- Tests: `./node_modules/.bin/vitest run`, `./node_modules/.bin/tsc --noEmit`,
  `npx playwright test` (starts its own dev server on a fresh database; live
  sandbox; Jev off unless `E2E_JEV=1`).
- `.env` holds `LITE_API_KEY` (sandbox) and `JEV_API_KEY`.
- Next step in order: Anthropic key → agent loop + intent scan; then OTP
  sign-in → member prices → rate re-check → payment row → booking claim.

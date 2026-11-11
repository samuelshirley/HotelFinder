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
| 7 | Turn route: durable turns, SSE, drain, reconcile, agent | done; **agent never run against the real model** |
| 8 | Form-in-chat onboarding, intent scan, pets question | done; scan not run live |
| 9 | UI: trips list, chat, resizable hotels panel, detail sheet, narrow layout | done; no map |
| 10 | Guards, e2e | guards done; one Playwright flow, no OTP (no sign-in yet) |
| 11 | Cost measurement | not started |

**Milestone reached 2026-11-11: it runs locally.** `scripts/dev.sh`, then
http://localhost:3000.

## What works end to end (verified in a real browser against the live sandbox)

Five-question form → first search → five ranked cards with a reason, total,
per-night, pay-at-hotel and cancellation line → detail sheet → reload keeps
the search → new search. `e2e/search.spec.ts`.

## Blocked on Sam

- **Anthropic key.** `ANTHROPIC_API_KEY` is set but not scoped to a
  workspace: every call is HTTP 400. Needs `ANTHROPIC_WORKSPACE_ID` in `.env`
  or a key made inside a workspace. Then run `scripts/agent-live.sh`, and
  again with `claude-haiku-5-5`, and fix whatever the 14 cases show.

## What is not built

- **Sign-in (OTP), member prices, booking and the payment row.** The Book
  button is disabled and says so. Every visitor is anonymous and sees public
  prices.
- **Staged yes, the 280 s turn budget, breakers.** Per-IP request limits and
  the two spend caps exist.
- **Map.** Needs a decision on Google Maps (paid) versus MapLibre.
- **Cost measurement** (step 11) and the persona-driven simulated users.
- `submit_idea` (the agent has no tool for feature requests yet).

## Not verified

- **Jev, live.** The first build session was not permitted to call
  api.typesafe.ai. `scripts/jev-live.sh` has not been run.
- **The agent and the scan, live.** See above and `docs/agent.md`.
- macOS: Sam ran it (2026-11-11 18:18); the form works there.

## Notes for whoever resumes

- Tests: `./node_modules/.bin/vitest run`, `./node_modules/.bin/tsc --noEmit`,
  `npx playwright test` (starts its own dev server on a fresh database; live
  sandbox; Jev off unless `E2E_JEV=1`).
- `.env` holds `LITE_API_KEY` (sandbox) and `JEV_API_KEY`.
- Next step in order: OTP sign-in → member prices → rate re-check → payment
  row → booking claim. Run the live agent cases as soon as the key works.
- e2e in the build VM: `PLAYWRIGHT_BROWSERS_PATH=$HOME/pw LD_LIBRARY_PATH=$HOME/lib/x/usr/lib/aarch64-linux-gnu ./node_modules/.bin/playwright test`.

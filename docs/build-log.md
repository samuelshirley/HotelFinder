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
| 6 | Jev module and router | built; run against the real Jev 2026-11-12: 46 of 46 cases |
| 6b | Jev answers questions about what is on screen (`docs/jev-expansion.md`) | built 2026-11-11; run live 2026-11-12, all 20 answer cases settle |
| 7b | Staged yes, the 280 s turn budget, chat breakers, `submit_idea` (`docs/agent.md`) | built 2026-11-12; turn-level tests on real Postgres; **not exercised in a browser or against the live model** |
| 7 | Turn route: durable turns, SSE, drain, reconcile, agent | done; agent verified live on Haiku 5.5 (14 cases) |
| 8 | Form-in-chat onboarding, intent scan, pets question | done; scan verified live |
| 9 | UI: trips list, chat, resizable hotels panel, detail sheet, narrow layout | done |
| 9b | Map over the list (MapLibre + OpenFreeMap), linked to the cards, two gestures, Penny's map tools (`docs/design/map.md`) | built 2026-11-12; verified in a real browser (`e2e/map.spec.ts`) |
| 10 | Guards, e2e | guards done; two Playwright flows: search, and book (OTP sign-in, test wallet, real sandbox booking, cancel) |
| 12 | Checkout: re-check, email-code sign-in, Apple Pay / Google Pay (TEST stand-ins), book, receipt, cancel | built 2026-11-11; verified live in the sandbox |
| 11 | Cost measurement | not started |

**Milestone reached 2026-11-11: it runs locally.** `scripts/dev.sh`, then
http://localhost:3000.

## What works end to end (verified in a real browser against the live sandbox)

Five-question form → first search → five ranked cards with a reason, total,
per-night, pay-at-hotel and cancellation line → detail sheet → reload keeps
the search → new search. `e2e/search.spec.ts`.

## What is not built

- **Real payments.** The Apple Pay and Google Pay sheets are test stand-ins:
  no money moves, and the sandbox books with its test card method
  (`ACC_CREDIT_CARD`, allowed only with a `sand_` key; guarded). The real path
  is LiteAPI's payment SDK (`transaction_id`), which `bookPaid` already takes.
- **Sign-in emails.** No `RESEND_API_KEY`: outside production the code is shown
  on the checkout page ("dev mailbox"); production with no key sends nothing.
- **A booking left "waiting for the hotel"** (book timed out) is never booked
  again, but nothing yet reads it back from the supplier; the guest is told to
  reload. Needs a client reference on book and a lookup by it (unverified).
- **Member prices after sign-in** apply to new searches; a booking keeps the
  price of the card that was pressed.
- **Cost measurement** (step 11) and the persona-driven simulated users.
- Stored ideas (`submit_idea`) have no admin page yet: `select * from ideas`.
- The detail slide-out still opens over the map.

## Not verified

- **Jev's settle rate on real traffic.** `scripts/jev-live.sh` was run on
  2026-11-12 from Sam's Mac: 46 of 46 cases, median 151 ms, about 2,290 input
  tokens a message. Two things it changed: "close to the old town please" now
  settles as `near` (the expectation was older than the feature), and "hide
  the map" came back tier T3 until the T1 wording named the screen. The cases
  are hand-written; the settle rate on what people really type is unmeasured.
- **Staged yes, the turn budget and `submit_idea` against the live model.**
  Whether Haiku calls `hold_for_confirmation` and `submit_idea` when it should
  is untested: the turn tests script the model.
- macOS: Sam ran it (2026-11-11 18:18); the form works there.

## Cost per search (2026-11-12, branch `admin-cost-view`)

`/admin`: median, p90 and max cost per search over 24h/7d/30d, the most
expensive searches with a Haiku / Jev / LiteAPI split, and each search's
ledger. LiteAPI calls are now priced (place calls $0.01 each, booking flow
free, hotel content unpriced); place lookups made before a search are
charged to it; sign-in emails are metered. Measured ~$0.020 per search, a
floor while content calls are unpriced. All of it: `docs/usage.md`.

## Notes for whoever resumes

- Tests: `./node_modules/.bin/vitest run`, `./node_modules/.bin/tsc --noEmit`,
  `npx playwright test` (starts its own dev server on a fresh database; live
  sandbox; Jev off unless `E2E_JEV=1`).
- `.env` holds `LITE_API_KEY` (sandbox) and `JEV_API_KEY`.
- Next step in order: OTP sign-in → member prices → rate re-check → payment
  row → booking claim. Run the live agent cases as soon as the key works.
- e2e in the build VM: `PLAYWRIGHT_BROWSERS_PATH=$HOME/pw LD_LIBRARY_PATH=$HOME/lib/x/usr/lib/aarch64-linux-gnu ./node_modules/.bin/playwright test`.

## A trap that cost a confused bug report (2026-11-11)

The e2e run starts `next dev` on this folder. It used to build into `.next`,
the same directory as a dev server that is already running, and left that
server showing a blank "missing required error components" page with stale
code. The e2e server now builds into `.next-e2e` (`NEXT_DIST_DIR`), and
`scripts/dev.sh` clears `.next` on start.

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
| 9c | Filters: star class, guest rating, kind of place, brand; chips, agent tools, Jev `filter` intent; neighbourhood not built (no field) (`docs/finder.md`, "Filters") | built 2026-11-13; PGlite on recorded fixtures, Jev live 53 of 53, `e2e/filters.spec.ts` against the sandbox; **agent tools not run against the live model** |
| 9d | "Show all N hotels": every hotel that fits under the top picks, paged, on the map, by chat (`docs/finder.md`) | built 2026-11-13; verified in a real browser (`e2e/full-list.spec.ts`); the pager not exercised in a browser (sandbox: one page) |
| 10 | Guards, e2e | guards done; two Playwright flows: search, and book (OTP sign-in, test wallet, real sandbox booking, cancel) |
| 12 | Checkout: re-check, email-code sign-in, Apple Pay / Google Pay (TEST stand-ins), book, receipt, cancel | built 2026-11-11; verified live in the sandbox |
| 12b | Checkout extras: pay now / at the hotel by named charge, special request to the hotel (`guests[].remarks`) and on the receipt, hotel-page FAQ from the chat's answer templates. No price timer: the prebook has no expiry (`docs/supplier.md`, "Checkout extras") | built 2026-11-13; verified in a real browser against the sandbox (`e2e/checkout.spec.ts`) |
| 11 | Cost measurement | not started |
| 12b | Deal Freeze: book a free-cancellation rate with no payment, confirm or release before 48 h ahead of its deadline (`docs/deal-freeze.md`) | built 2026-11-13, sandbox only; e2e against the live sandbox (`e2e/freeze.spec.ts`); the sweep has no scheduler yet and reminders are display-only without Resend |
| 13 | Saved hotels (the heart) and the currency picker (`docs/saved.md`) | built 2026-11-13; e2e `saved.spec.ts` in a real browser on the live sandbox; Jev and the agent run live on the save cases |
| 13b | Room splits ("best price" rooms): each split priced, cheapest combination per hotel, shown on the card, booked exactly (`docs/finder.md` "Room splits", `docs/supplier.md` §8) | built 2026-11-13; recorded fixtures; `e2e/rooms.spec.ts` passed on the live sandbox (signed in; stops at checkout); agent tool change not run live |
| 13c | A second language: Spanish. Catalogues for UI, fixed lines, answers, reasons and errors; a picker; Spanish slot extraction; the supplier asked in Spanish (`docs/i18n.md`) | built 2026-11-13; `e2e/spanish.spec.ts` passes against the sandbox. **Not done:** HotelDetail, Checkout. **Never run:** Jev and the agent on Spanish (live cases added) |
| 14 | Phone audit fixes (2026-11-13): pets read from the hotel's own listing; no onboarding dead ends; sent messages never vanish; first-message dates kept; "Sign in to see price"; checkout sign-in first; phones get a Chat · Hotels · Map · Trips tab bar (`docs/design/mobile.md`) | built 2026-11-13; unit, pg and e2e at 390×780 in Chromium; **keyboard handling not yet checked on a real iPhone** |
| 15 | Sights: "tour some museums" → Google's most popular museums or galleries, hotels ranked close to the middle of them, a day-by-day plan with Google Maps links, marks on the map (`docs/sights.md`). Change lines no longer end in "N of M hotels fit" | built 2026-11-13; unit and PGlite on recorded Google responses; Jev live 87 of 87; agent live on Sam's message; `e2e/ui/sights.spec.ts` (`@ai`, desktop and 390×780) on the sandbox. **CI does not run it** (needs Jev and a Google key) |

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

- **Per-PR preview environments** (2026-11-13, `docs/deploy.md`): Neon
  branch per PR, migrated then emptied, Vercel preview pointed at it, sticky
  comment, teardown on close; Git-integration deploys limited to `main`.
  Never run in GitHub Actions: needs Sam's four repo secrets and the Preview
  `DATABASE_URL` removed in Vercel first. The wipe ran against a local
  Postgres; the sweep against a stubbed API.

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

- 2026-11-13 outage (migration 0005 never applied; typed searches 500): migrations now run on production builds, `/api/health`, refs on 500s, CI on PRs. `docs/deploy.md`.

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

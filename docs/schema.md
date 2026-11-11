# Schema and repos

2026-11-11, build step 2. What is here, why, and what the tests prove.

## Tables (18)

Auth: `users`, `accounts`, `sessions`, `verification_tokens`, `email_otp_codes`.
Store: `search_sessions`, `stays`. Chat: `agent_turns`, `chat_history`.
Inventory: `properties`, `offers`, `shortlist_entries`. Accounts:
`user_preferences`, `bookings`. Ledger and switches: `usage_events`,
`app_meta`, `ip_request_counters`, `ideas`.

## Rules the database enforces itself

| Rule | How |
|---|---|
| One running turn per session | partial unique index `agent_turns_one_running_idx` on `(session_id) WHERE status = 'running'` |
| A retried send is the same turn | unique `idempotency_key` |
| A session has an owner | check: `user_id` or `anon_id` is set |
| Check-out is after check-in | check on `stays` |
| A finder shortlist row has a priced offer and a reason | check `shortlist_finder_rows_sourced` |
| An offer expires after it was fetched; totals are not negative | checks on `offers` |
| One booking per supplier prebook | unique `(supplier, prebook_id)` |
| Spend history and booking records outlive the account | `ON DELETE SET NULL` on `usage_events.user_id`, `bookings.user_id` |

## Rules the repos enforce

- **Audience.** `offers.ts` has one `visibleTo(audience)` predicate and every
  read goes through it; `shortlist.ts` leaves out an entry whose offer the
  audience may not see. The audience comes from `audienceFor(session)`, which
  reads sign-in state. Nothing takes it from a request.
- **Ownership.** `assertSessionOwned` opens an adopted session for its user
  only. The anonymous cookie that created it stops working at adoption, and a
  second account signing in on the same browser adopts nothing already owned.
- **Shortlist sources.** `finderShortlist.ts` is the only writer of `finder`
  rows. `addUserNamedProperty` has no source parameter. A guard test will pin
  who may import `finderShortlist.ts` once the finder exists (step 4).
- **Booking states.** `lib/bookingStates.ts` is the pure transition map; the
  repo applies it as the WHERE of the update, so an illegal move changes zero
  rows. `failed` is reachable until `confirmed`, because book can fail after
  the card cleared. `paid → booking` is a claim taken before the
  supplier's book call, because that call is not idempotent
  (`docs/supplier.md`); four concurrent claims yield one winner.
- **Model-visible chat.** Only `user` and `ai` rows are returned by
  `listModelVisibleTail`. Form rows, the payment row and receipts never enter
  model context.
- **AI spend.** `aiSpendMicrocentsSince` counts `anthropic%` and `jev` rows
  only. Supplier and Google rows are logged and gate nobody.

## Choices worth knowing

- **Money is integer minor units plus a currency code.** `schemaGuard.test.ts`
  fails if a `*Minor` column is anything but `integer(`.
- **`usage_events.cost_microcents` is bigint.** 1 cent is 1,000,000 microcents,
  so about $21 overflows int4.
- **Every timestamp goes through `ts()`**, the one place `timestamp(` is
  called, so a column without a time zone cannot be declared.
- **`shortlist_entries` keeps two rank sequences.** Finder rows are ranked by
  the finder; user-named rows count 1, 2, 3 in the order asked. The list is
  ordered by source (finder first, relying on the enum's declaration order),
  then rank.

## What went wrong while building it

**A flaky test, reproduced before it was fixed.** `offers.test.ts` failed 7
runs in 12. A user-named row and a finder row both had rank 1, and the list
ordered by `rank, id`, so the random uuid decided the order. The cause was the
design, not the test: two writers shared one rank sequence. Fixed by the two
sequences above; 0 failures in 30 runs after. The test now uses two rows of
each source so an ordering by rank alone can never pass by luck.

**`npm install` crashes without `--legacy-peer-deps`** (npm 10.9.9, arborist
`Cannot read properties of null (reading 'edgesOut')` while loading the peer
set). `.npmrc` sets `legacy-peer-deps=true`. I did not identify which
dependency triggers it.

**The build VM's scratch disk filled during the test loops** (`ENOSPC`, 9.8 GB
volume at 100%, 417 MB of it this session's npm cache). Runs in that window
printed nothing or failed without a test failing. Clearing the npm cache freed
it. Tests are now run through `./node_modules/.bin/` rather than `npx`.

## Mutation checks (each run, watched fail, restored)

18 mutations, all caught: raw `timestamp(`; money as float; stay date as text;
one-running index made non-unique; finder-row check removed; session-owner
check removed; member offers visible to public (offers and shortlist);
adopted session still opening for the cookie; adoption taking owned sessions;
booking skipping states; receipt shown to the model; Google counted as AI
spend; idempotency key not unique; offer readable across sessions; finder
replace wiping user-named rows; shortlist ordered by rank alone; user-named
rank counting finder rows.

One survived on the first pass (adoption taking owned sessions): no test
covered a shared browser. A test was added and the mutation is now caught.

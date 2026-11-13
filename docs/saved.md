# Saved hotels and the currency picker

Built 2026-11-13 (Vio.com parity). Two small features that share nothing but
the build.

## Saved hotels (the heart)

**What.** A heart on every card and beside the name in the detail view. The
saved list sits in the left column under "Your trips", newest first. Each
entry opens the search it was saved from. In the chat, "save the second one"
and "show my saved hotels" do the same through the agent.

**Owner.** `saved_hotels` rows are owned the way a search is
(`repos/sessions.ts`): by the account, or before sign-in by the signed
anonymous cookie (`auth/anon.ts`). At sign-in `signInBrowser` hands the
cookie's rows to the account with its searches (`adoptAnonymousSaved`); a
hotel the account had already saved keeps the account's row, so nothing is
doubled. After sign-out the cookie sees none of them.

**No price is stored.** The list shows the **last price found**: the newest
search offer for that hotel in any search the owner owns, with the nights it
was for and the day it was fetched, e.g. "Last price found: €115.49 for
20–22 Nov, 2 nights, on 13 Nov". It is read from offer rows at request time
(`listSaved`), never written to the saved row, and never shown as a current
price; the hotel is priced again when its search is opened. Rules held by
tests (`src/test/pg/saved.test.ts`):

- an anonymous owner is shown public offers only, so a member price never
  reaches a visitor who is not signed in, even one held in their own search;
- a hotel's other rooms (detail rates) are not the price shown;
- after sign-in the cookie no longer reads prices from the searches it
  handed over;
- only a hotel on the visitor's own list can be saved (`saveFromSearch`),
  so an id from anywhere else saves nothing;
- one row per owner and hotel, and no row without an owner (the database).

**Route.** `POST /api/saved`, one Zod payload: `{saved: true, propertyId,
sessionId}` or `{saved: false, propertyId}`. `GET /api/saved` lists. Both
answer with the whole list.

**Chat.** Two agent tools, `save_hotel {position}` and `show_saved {}`. The
agent names the hotel by position, never by id; the turn saves it through the
same `saveFromSearch` the heart uses and then says the fixed line
(`savedLine`, `savedListLine` in `lib/replies.ts`): names only, no price in
the chat. The message carries `ui: {saved: 'show'}` and the client opens the
list. Jev has a `save` intent ("save, keep or favourite one of the listed
hotels, or see the saved ones; not booking") that defers to the agent, so a
save is never read as `book`. Live, 2026-11-13: Jev picked `save` at 1.0 for
both test messages, all 48 Jev cases pass; `scripts/agent-live.sh` 21 of 21,
including the save and list case.

**Not built.** Saving from outside a search (a hotel page with no search);
refreshing a price without opening its search; a saved list per trip.

## The currency picker

**What.** A chip on the second header row, "Prices in EUR ✎". The editor
lists the common currencies first, then every code the supplier prices in.
Changing it is the typed action `set_currency` through the edit route and
`dispatchActions`, like `set_nationality`: the session's currency changes and
the finder searches again. The supplier converts; we never do.

**The list.** `lib/currencies.ts` is generated from the recorded
`/data/currencies` answer (136 codes) and `currencies.test.ts` fails if they
drift. A code outside it is refused by the action schema. The reason it must
be: LiteAPI does not refuse an unknown currency, it answers "no availability"
(`rates-currency-unknown.json`), which would read as "no rooms".

**Recorded** (`node scripts/capture-liteapi-fixtures.mjs --add-currencies`):
`currencies.json`, `rates-city-porto-usd.json` (the same 20 Porto hotels in
USD: every total, fee and cancellation penalty came back in USD), and
`rates-currency-unknown.json`.

**The price cap goes.** A cap is in the session currency's minor units. A new
currency drops it rather than converting it; the editor says so before Apply
when a cap is set. The search fingerprint includes the currency, so a change
staged in euros is never applied after the prices moved.

**Held rates.** The finder ranks the latest fetch only, so the old currency
leaves the list at once. A hotel's detail rates held in the old currency are
ignored and fetched again (`hotelRates.ts`; pg test).

**Not built.** Remembering the currency for the next search (each new search
starts in EUR); a currency for the chat ("show prices in dollars" goes to the
agent, which has no tool for it).

## Mutation log (2026-11-13)

Killed: anonymous owner shown member offers; detail rates counted as the last
price; adoption doubling a hotel the account had saved; the cookie still
seeing adopted rows; the cookie reading prices from adopted searches (survived
the first pass: a test was added); detail rates in the old currency reused;
the session currency not persisted; the cap kept on a currency change; the
currency left out of the fingerprint.

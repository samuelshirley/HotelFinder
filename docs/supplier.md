# Supplier adapter (LiteAPI)

2026-11-11, build step 3. `src/server/supplier/` is a bounded module: the rest
of the app imports `index.ts` and `types.ts` and nothing else
(`supplierBoundaryGuard.test.ts`).

## Shape

- `types.ts`: the supplier-neutral interface (`searchPlaces`,
  `searchAvailability`, `getStaticContent`, `recheckRate`, `book`,
  `getBooking`, `cancel`) and the normalized `SupplierOffer`,
  `SupplierProperty`, `CancellationPolicy`, `RateCheck`, `SupplierBooking`.
  Every method returns a value, `{ok:true,value}` or `{ok:false,error}`;
  nothing throws.
- `liteapi/http.ts`: one fetch with a timeout. Error text never carries the
  key, the URL, the request or the response body.
- `liteapi/schemas.ts`: Zod, taken from the recorded responses. Loose on extra
  fields, strict on what a user sees or we send back.
- `liteapi/normalize.ts`: pure. Validated body in, app shapes out.
- `liteapi/adapter.ts`: HTTP → supplier error body → schema → normalize → one
  meter event per call (`liteapi:search`, `:places`, `:content`, `:prebook`,
  `:book`, `:booking`, `:cancel`).
- `index.ts`: `getSupplier({sessionId,userId})`, wired to the usage ledger.

## What the sandbox taught us (all recorded in `liteapi/__fixtures__/`)

1. **Book is not idempotent.** Sending the same `prebookId` to
   `/rates/book` a second time returned a second CONFIRMED booking with a new
   id, twice in two captures (`book-same-prebook-again.json`). Both extra
   bookings were cancelled. Consequences in the code:
   - the booking row has a `booking` claim state; only the caller that moves
     the row `paid → booking` may call `book`, and four concurrent claims
     produce exactly one winner (pg test);
   - the adapter makes one book call and never retries (test);
   - a row stuck in `booking` is resolved by reading the booking back, never
     by booking again.
   This was observed with the sandbox's `ACC_CREDIT_CARD` method. Whether
   production with `TRANSACTION_ID` behaves the same is not known; the guard
   does not depend on the answer.
2. **"No availability" is an error body on HTTP 200**
   (`{"error":{"code":2001}}`). The adapter returns it as an empty result;
   whether to retry is the finder's decision.
3. **An offer covering two rooms is one `roomType` with two `rates`.**
   `offerRetailRate` is the whole stay; pay-at-property charges are per room
   and are summed.
4. **Fee descriptions are free text, not an enum**: `CITY_TAX`, `City Tax`,
   `city fee`, `€12 eur per room per stay`. They are shown as supplier text
   and never matched on.
5. **Cancellation times are `"YYYY-MM-DD HH:mm:ss"` plus a `timezone` field**,
   always `GMT` in what was recorded. Anything other than GMT/UTC is kept raw
   and yields no stated deadline, rather than a guessed offset.
6. **The suggested selling price** is on the room type and again at prebook.
7. `et: 10800` appears on each hotel in a rates response. Its meaning is not
   documented where I looked; nothing depends on it.

## Checkout extras (2026-11-13)

Three questions asked of the sandbox before building anything
(`--add-checkout-extras`: `prebook-checkout-extras`, `prebook-get`,
`rates-city-porto-payment-types`, `book-with-remarks`,
`booking-get-with-remarks`, `booking-cancel-with-remarks`). Each answer is
pinned by a test over the recording (`normalize.test.ts`, "evidence for the
checkout"; `adapter.test.ts`).

1. **A prebook carries no expiry, so there is no price timer.** No field in
   the prebook, in the prebook read back (`GET /prebooks/{id}`), or in any
   earlier prebook recording names an expiry, a hold or a validity window,
   and the book reference does not state one (it lists a 410 "rate expired"
   with no time). A countdown would be a number we made up, so none is shown.
   What stands instead is our own rule, `PRICE_CHECK_TTL_MS` (20 minutes,
   `server/checkout.ts`): an older check is checked again before anyone pays,
   and the page says that in words, never as a countdown. `et: 10800` on each
   hotel in a rates answer (item 7 above) is still undocumented and still
   unused. If the supplier adds a real expiry, the timer reads it.
2. **Special requests are supported: `guests[].remarks`.** Sent in the book
   request, the sandbox kept the text and returned it on the booking (as
   `remarks`, `bookedRooms[].remarks`, `bookedRooms[].guests[].remarks` and,
   on the read-back, `specialRemarks`). The reference marks it "not
   guaranteed". The app: a 500-character box at checkout (Zod at the route,
   `cleanSpecialRequest` in `lib/checkout.ts`: trimmed, control and invisible
   characters dropped, never read or matched), kept on `bookings.special_request`,
   sent with every room on the one book call, shown on the receipt with
   "requests are not guaranteed". Never in the usage ledger. A top-level
   `remarks` in the request is not in the schema and was not tried.
3. **No pay-later and no pay-at-property rate was offered.** 150 room types
   over 30 Porto hotels: every one `paymentSchedule: "now"` and
   `paymentTypes: ["NUITEE_PAY"]`; no `PROPERTY_PAY`, no
   `CREDIT_CARD_SCHEDULED`. The reference says `later` needs scheduled card
   payments enabled on the account and the guest's card sent through
   `CREDIT_CARD_SCHEDULED`, which this app never does (card data never
   reaches our server). So the checkout says "Pay now" for the total and
   lists, under "Pay at the hotel", the charges the rate marks not included,
   each named as the supplier names it and in its own currency (kept on
   `bookings.pay_at_property_fees` at the price check). A `PROPERTY_PAY` rate,
   if one ever appears, is not handled: what our checkout would charge for it
   is an open question.

Also in the book reference, not acted on: `clientReference` is documented as
an idempotency key ("reusing an existing one returns error 4005"). Not tried
in the sandbox; the claim rule above does not depend on it.

## Money

`lib/money.ts` turns a supplier decimal into integer minor units, by decimal
string, for 0-, 2- and 3-decimal currencies. `Math.round(1.005 * 100)` is 100;
`toMoney(1.005, 'EUR')` is 101, and a test pins both.

## Fixtures

`node scripts/capture-liteapi-fixtures.mjs` records 18 sandbox responses and a
`manifest.json` with the request, status and sha256 of each. It refuses a
non-sandbox key. One field is changed at capture: the prebook `secretKey` (a
Stripe client secret) becomes `REDACTED_AT_CAPTURE`. `fixturesGuard.test.ts`
fails if a fixture is edited, added by hand, or contains a key or a secret.

Schema-drift tests derive a broken variant in memory from a recording; the
file on disk is never edited.

## Live check

`liteapi/live.test.ts` runs the adapter against the real sandbox when
`LIVE_LITEAPI=1` (place search, search by place, children by age over two
rooms, margin raising the price, prebook, static content, unknown booking).
6 of 6 passed on 2026-11-11. It is skipped in `npm run test`.

## Mutation checks

23, all caught: pay-at-property counting included fees; money by float
multiply; any time zone read as UTC; no-availability as a failure; booking
with the account card; network error text leaking the URL and key; offer id
optional; price coerced from a string; meter failure thrown into the call;
everything refundable; one refundable room being enough; latest deadline
instead of earliest; children's ages dropped from the request; unknown status
read as confirmed; client secret in the ledger; margin not sent; book retried
on timeout; total from the first room only; schema error message carrying the
value; fixture edited by hand; hand-written fixture added; outside file
importing the adapter (alias and relative path).

## Not done here

- No retry policy. The finder owns retries for search; book is never retried.
- No cache. Static content and rate caching arrive with the finder (step 4).
- `getSupplier` builds only LiteAPI. A second supplier adds a branch there.

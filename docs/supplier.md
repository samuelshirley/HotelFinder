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
   and are summed. Each room also lists its own fees and its own cancellation
   charges. Shown, fees with the same text, currency and included flag are one
   line with the rooms' sum (`mergeFees`, `lib/checkout.ts`; before 2026-11-14
   a split read "City tax, City tax"), and the offer's cancellation charge at
   each moment is the sum of every room's charge then (`combinePenalties`,
   `normalize.ts`; before, the detail showed one room's charge as the cost of
   cancelling both).
4. **Fee descriptions are free text, not an enum**: `CITY_TAX`, `City Tax`,
   `city fee`, `€12 eur per room per stay`. They are shown as supplier text
   and never matched on.
5. **Cancellation times are `"YYYY-MM-DD HH:mm:ss"` plus a `timezone` field**,
   always `GMT` in what was recorded. Anything other than GMT/UTC is kept raw
   and yields no stated deadline, rather than a guessed offset.
6. **The suggested selling price** is on the room type and again at prebook.
7. `et: 10800` appears on each hotel in a rates response. Its meaning is not
   documented where I looked; nothing depends on it.
8. **Pets: three fields that disagree** (measured 2026-11-13 on 48 hotels in
   Annecy, Porto, Lisbon and Barcelona; recorded with
   `--add-pet-details`). Whether a hotel takes pets is in the details call's
   `petsAllowed` flag, its `hotelFacilities` list ("Pets allowed"), and its
   `policies` (`POLICY_HOTEL_PETS`). The bulk `/data/hotels` list carries only
   facility ids (id 4), no flag and no policy.
   - `petsAllowed` is `true` only when a structured pet policy exists, and
     `false` for 16 of the 48 hotels whose own facilities say "Pets allowed"
     (Novotel Annecy Centre among them). A false flag alone means "not
     stated".
   - Hotels with a pet policy (ibis Annecy Centre Vieille Ville, Rivage,
     Impérial Palace) do not list facility 4, so the bulk list misses them.
   - One hotel lists the facility AND a policy "Pets are not allowed."
     (Hilton Porto Gaia).

   `petsFromListing` (`liteapi/amenities.ts`) is the one reading: an explicit
   "not allowed" policy wins; the flag, the facility or an "allowed" policy is
   a yes; anything else is null, "the listing does not say", never "no". On a
   trip with a pet the finder confirms every candidate from its own details
   (free: `src/lib/supplierPrices.ts`), once per hotel, before ranking on it.
   Found because the shortlist's only dog-friendly hotel showed "No pets" on
   its own page (docs/testing.md, "How the 2026-11-13 bugs were found").

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

## Currency

The session's currency is sent with every rate search, and the supplier
prices in it: recorded in USD, every total, fee and penalty came back in
USD. We never convert. An unknown code is not refused; it comes back as
"no availability" (`rates-currency-unknown.json`), so only the codes in the
recorded `/data/currencies` list are ever sent (`lib/currencies.ts`). The
picker: `docs/saved.md`.

## Fixtures

`node scripts/capture-liteapi-fixtures.mjs` records 18 sandbox responses and a
`manifest.json` with the request, status and sha256 of each. It refuses a
non-sandbox key. One field is changed at capture: the prebook `secretKey` (a
Stripe client secret) becomes `REDACTED_AT_CAPTURE`. `fixturesGuard.test.ts`
fails if a fixture is edited, added by hand, or contains a key or a secret.

Schema-drift tests derive a broken variant in memory from a recording; the
file on disk is never edited.

`--add-hotel-types` (2026-11-13) records `/data/hotelTypes` (the id → name
list the property-type filter is checked against) and one page of Porto's
static list at offset 300, where apartments, hostels, B&Bs, guest houses and
an aparthotel sit beside hotels (the 20 in `rates-city-porto.json` are all
type 204). See `docs/finder.md`, "Filters".

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

## Rate limits (2026-11-14, `--add-spanish-places`)

The sandbox key allows about **5 place searches a second**, for every visitor
and every test run at once (measured: 20 different lookups sent together, 14 answered
`429 {"error":{"code":4290,…}}`; 12 sent 250 ms apart, 2 refused; 10 of one
same query sent together, none refused). The trip box looks places
up while the words are typed (a 250 ms pause is enough), so a first message
could be refused at once: "La búsqueda de lugares no ha respondido" 1.8 s
after "Madrid, España, del 8 al 10 de enero…" on the live site, 2026-11-14.

So a place lookup (`searchPlaces`, `getPlace`) answered 429 is asked again
after 500 ms, then after 1 s; the third refusal is returned as before. Each
attempt is a request and is metered. Only 429, only these two read-only
lookups: a timeout or a 5xx is not retried here, and book never is.
`places-rate-limited.json` is a recorded refusal.

## Not done here

- No retry policy beyond the place lookups' 429 (above). The finder owns
  retries for search; book is never retried.
- No cache. Static content and rate caching arrive with the finder (step 4).
- `getSupplier` builds only LiteAPI. A second supplier adds a branch there.

## 8. Several rooms (2026-11-13, `--add-room-splits`)

- **One search prices one split.** `occupancies` is one entry per room; each
  offer (`roomTypes[i]`) has one rate per room with its own `name`, adults and
  children, and `offerRetailRate` is all rooms together. A different split is
  a different search: the supplier does not compare splits for us.
- **Different rooms in one offer, one booking.** The supplier itself combines
  rooms: "Twin Room Classic + Double Room Classic", "Triple Room + Vincci Room"
  (probed), "Vincci Room + Vincci Room Uso Individual" (recorded). That last
  offer was prebooked (`prebook-mixed-rooms`: both rates, with name and party)
  and booked with one guest per `occupancyNumber` as ONE booking, CONFIRMED,
  price the offer's, then cancelled with a full refund (`book-mixed-rooms`,
  `booking-get-mixed-rooms`, `booking-cancel-mixed-rooms`). One prebook takes
  one `offerId`, so rooms from two different offers (or two searches) cannot
  be put into one booking; the app never tries: a hotel's combination is
  always one offer.
- **The sandbox's booking echo is not the booking.** `bookedRooms` named the
  rooms "Test rate 1/2" with 1 adult each for a 2 + 1 booking. Nothing reads
  room names or parties from a booking; they come from the prebook.
- **Prebook says which rooms it holds**, so `RateCheck.rooms` carries them
  (empty unless every rate says its name and party) and checkout compares.
- Recorded at the 15% public margin, hotel ids of `rates-city-porto`:
  `rates-four-adults-one-room` (6 hotels), `rates-four-adults-two-rooms` (20),
  `rates-family-one-room` (9), `rates-family-two-rooms-split` (20), and
  `rates-mixed-rooms` (2 + 1 adults, 5 rates a hotel: the offer booked).

## 9. Public and member prices (2026-11-13)

What LiteAPI's terms and the sandbox allow, for showing and booking a price to
a visitor who is not signed in. Sources: LiteAPI's revenue-management guide
(`docs.nuitee.com/docs/revenue-management-and-commission`) and the prebook
reference (`docs.nuitee.com/reference/post_rates-prebook`), read 2026-11-13;
sandbox probes the same day (Porto, 2 adults, 30 hotels, margins 0, 3, 15).

**The terms.**
- `suggestedSellingPrice` (SSP) is "the floor for public selling". Selling
  under it "in a public forum" is a rate violation. Selling at or above it on
  a public website is allowed.
- Closed user groups may be sold under it; "discounts to logged-in users only"
  is the guide's own example. Our signed-in members (email code) are one.
- `margin` is set on the rates search only. The prebook has no margin or price
  field: the price is fixed in the `offerId`.

**Verified in the sandbox.**
- **The SSP LiteAPI reports is the larger of the hotel's floor and our
  price.** At margin 15 a hotel whose 15% price was above its floor came back
  with `suggestedSellingPrice` equal to the price; one under it kept the floor
  (lp775dd: 210.99 against 211.02). So "under the SSP" is decidable from the
  rates response alone, at any margin.
- At the member margin (3%) 20 of 30 hotels were under their SSP; at 15%, 8
  of 30, several by 3 cents (the group searches: `prebook-mixed-rooms` is
  363.46 against 363.49).
- **Booking a public visitor at the SSP works**: search that one hotel again
  with the margin that lifts the net rate to the SSP (net = total less
  `commission`, which every rate carried), rounded up. lp775dd, net 183.49,
  SSP 211.02: margin 15.01 gave 211.03, and the prebook held 211.03 with
  `suggestedSellingPrice` 211.03. A `margin` sent with the prebook is ignored
  (same price; it is not in the spec).

**What the app does with it** (`lib/pricing.ts`, `server/checkout.ts`).
- Every search is made at one margin, the member margin. A signed-out
  visitor's row holds the hotel's SSP when the rate is under it
  (`lower_for_members`), and nothing derived from the rate: no included tax
  amounts, no cancellation charges. The member rate is never written to an
  anonymous session.
- A signed-out card says "Sign in for a lower price", never by how much: the
  amount plus the price shown would publish the member rate.
- Booking needs an account, so the UI asks for the email first and checks the
  member rate. The API still takes a signed-out checkout (and a signed-out
  confirm, which signs in with the code): for a room under its SSP it searches
  the hotel at the margin that reaches the SSP and prebooks that, so the
  signed-out price is a real, bookable public price. A prebook that comes back
  under its SSP for a signed-out visitor is fetched again, or refused.
- The 15% public margin is gone: since sign-in comes before payment, nobody
  paid it except those who signed in with the code in the same press.

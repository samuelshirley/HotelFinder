# The stay finder

2026-11-11, build step 4. `lib/finder/` is pure; `server/finder.ts` does the I/O.

## What it does

`fetch (only when needed) → hard constraints → rank → shortlist of five, each
with a machine-readable reason`. No model is involved at any point.

- **Fetch and rank are separate.** A refinement that does not change where,
  when or who re-ranks the offers already held: zero supplier calls (tested).
  Held rates live 15 minutes (`OFFER_TTL_MS`) and are always re-checked before
  payment.
- **One candidate per hotel**: its cheapest live offer.
- **Hard constraints**: the per-night cap (whole party, rounded up), every
  must-have, the user's exclusions, and for an anonymous visitor no price
  under the hotel's suggested public price. For a city searched with no place
  named, the city bound ("In the city", below).
- **Must-haves are only what the supplier can answer structurally**
  (`lib/amenities.ts`, 12 amenities from facility ids, plus free cancellation
  and breakfast from the offer). Amenities unknown for a hotel never satisfy a
  must-have. "Quiet", "safe" and "walkable" are not must-haves: no field
  answers them.
- **Priorities** (`cheapest`, `closest`, `nicest`, `basic`) are lexicographic
  orders that each end in all four metrics. With no priority chosen, a
  balanced score (price 0.5, rating 0.3, distance 0.2).
- **Distance** is straight-line, in 100 m steps, from the place the user named
  or else from the middle of the results; the reason says which.
- **One margin** for every search, a setting (`MEMBER_MARGIN_PCT`, 3 by
  default), not a constant. Signed out, a hotel is shown at its own public
  price when the rate is under it (`docs/supplier.md` §9); the ranking sees
  the price shown, never the margin.

## How it is judged

- **20 personas** (`lib/finder/personas.ts`) on the recorded Porto search of
  20 real hotels. Each is checked against an oracle written from the raw
  supplier data, not the ranking's own predicates. "Best" is relative: there
  is no single golden list.
- **Dominance**, 400 random searches per priority: a hotel no worse on price,
  distance, rating and review count, and better on one, never ranks lower.
- **Purity**: the same candidates in any order give the same ranking.

## What the dominance test found

It failed on the first run for four of five priorities. Ranking used the
exact distance while the user is shown 100 m steps, so a dearer, worse-rated
hotel ranked first for being 20 m closer while both read "0.5 km". The order
is now decided on the number shown.

## Mutation checks

26, all caught after three tests were added for survivors ("Room Only" read
as breakfast, `nicest` ignoring review count, the dearest offer chosen per
hotel, ranking mixing public and member offers).

## Not built yet

Walking time (straight-line only). Static content cache beyond the amenity
facts. Near-miss suggestions when nothing is eligible (the outcome carries
the rejection counts; the chat does not word them yet).

## Never a list of one (2026-11-12)

Reproduced on the live app: an anonymous Puerto Escondido search, no cap, no
must-haves, listed one hotel, "1 of 11 hotels fit". The other ten were cut by
the public-price rule (their rate is under the hotel's public price). So the
cheaper hotels were the hidden ones, and Penny then told the user the €209
hotel was the only one on screen.

Now, when fewer than `MIN_SHOWN` (5) fit, `rankStay` returns `nearMisses`:
the rejected hotels (never one the user set aside), fewest misses first, then
the same order as the shortlist, each with a typed list of what it misses
(`over_price_cap` with the amount over, `missing_must_have` split into known
lacking and unknown, `member_price`). The finder stores them as finder rows with
reason `near_miss`; the panel shows them under a divider.

- **A member-price near-miss holds no offer** (`offer_id` null) and no number
  derived from one. The schema check `shortlist_finder_rows_sourced` allows a
  finder row without an offer only for that reason. So the price cannot reach
  an anonymous visitor by any route: view, answers, agent context, checkout.
- **The same rule now guards rooms & rates and checkout** (`isMemberOnlyPrice`
  in `lib/pricing.ts`). Before this, an anonymous visitor's rooms and rates
  listed rates under the public price; the recorded Porto search holds two.
- **Answers about "the cheapest", "do they all…"** range over hotels that fit,
  over everything only when none fit. A question about one hotel works for any
  card on screen.

Mutation checks: 15, 14 caught. The survivor is Penny's pick skipping
near-miss rows, which is unreachable (she picks at 8 fits, filling stops at 5)
and kept as a backstop.

Open: the hidden hotels could instead be shown *at* their public price (the
margin raised to meet it), which is allowed and earns more. That needs the
offer's price to be the price booked, so it is a supplier/checkout change, not
a ranking one. Not built.

## Filters (2026-11-13)

Vio-parity filter chips beside the price cap and the must-haves: **star
class** (3+, 4+, 5), **guest rating** (7+, 8+, 9+), **kind of place** and
**brand**. Each is a typed action (`set_min_stars`, `set_min_rating`,
`set_property_types`, `set_chains`) with a pure reducer (a re-rank, never a
new search), four columns on `stays`, a hard constraint in `rankStay`, a chip
in the results header, an agent tool, and (stars, rating, kind) a Jev intent.
Code: `lib/filters.ts`, `filterMisses` in `finder/rank.ts`.

**What the supplier data holds**, checked before building
(`liteapi/__fixtures__/`, plus a read of the sandbox's Porto, Lisbon and
Barcelona lists on 2026-11-13, 1,000 hotels each):

| Filter | Field | Notes |
|---|---|---|
| Stars | `stars` on the rates response | `0` is "not rated" (110 of 1,000 in Porto), read as unknown |
| Rating | `rating` on the rates response | out of 10 |
| Kind | `hotelTypeId` on `/data/hotels` (the static facts call) | id → name from `/data/hotelTypes`, recorded as `hotel-types.json`. Seen: apartments 578, hotels 185, guest houses 129, hostels 39, B&Bs 28, aparthotels 23, holiday homes/villas 13 (Porto) |
| Brand | `chain` on `/data/hotels` | `"Not Available"` on 850 of 1,000 in Porto: read as "names no brand", not as "independent" |
| Neighbourhood | none | **Not built.** The listing has a street address, a postcode and a city, no district. A postcode is not a neighbourhood a person would name, and guessing one from it would be authoring. "Close to" a named place (`set_near`, ranked by distance) is the honest way to ask for an area; the agent offers it. |

The kind ids are mapped in `liteapi/propertyTypes.ts` (seven kinds; a test
checks every mapped id's name against the recording). Any other id is
`other`: known, but not a kind offered.

**A listing silent on the field is never dropped silently.** It misses the
filter with its value null; the card says "the listing does not give a star
class" / "does not say what kind of place it is" / "names no brand", and when
nothing fits the chat line says how many a filter left out and for how many
the listing was silent (`filterUnknown`). Without static facts (the call
failed) every hotel misses a kind or brand filter that way (PGlite test).

**The chips offer only what the held listings carry**: the kind and brand
editors list values among the hotels the finder ranks over, with counts, and
say how many name none. A brand from the chat goes through `set_brands`, which
maps what the user said onto one of those chain names (exact, or the one chain
whose name holds it as whole words); the action carries the supplier's
spelling, never the model's.

Measured with Jev live (2026-11-13): the six new filter cases read intent
`filter` at 0.99–1.0 with the right `filter_kind` at 1.0, except "any star
rating is fine" (intent 0.61, `removing` 0.17), which defers. The 46 earlier
cases still pass (53 of 53). The added intent and question cost about 220
input tokens a message (2,510 against 2,290).

Mutation checks: 5, all caught (a kind id moved to another kind; "Not
Available" read as a brand; an unknown star class passing the filter; the
model's brand spelling passed through; the hotel-type mapping not matching the
recording).

Open for Sam: whether to offer the 7 kinds, or fewer (Vio shows hotel /
apartment / hostel / B&B); whether unrated (`0`) hotels should pass a star
filter; brands are offered from the current results only, so a brand absent
from them cannot be picked from the chip.

## The full list: "Show all N hotels" (2026-11-13)

Vio lists every available hotel and lets you narrow. Sam's choice: keep the top
picks with their reasons, and under them a "Show all N hotels" control that
opens every hotel the search priced **that fits** (the same filters, must-haves,
cap, set-asides and public-price rule), in the finder's own order.

- **The rows are the finder's.** `rankStay` already returns `ordered`, every
  eligible hotel in order; `runFinder` now stores the part after the top picks
  as finder rows with reason `full_list` (`lib/fullList.ts`), holding only
  `distance_km` and `per_night_minor`. Same writer, same transaction, same
  guard (`shortlistSourceGuard`). Near-misses exist only when fewer than five
  fit, so the two never share a rank.
- **They are not on the shortlist.** `listShortlist` leaves them out, so the
  chat, Jev's `hotels_on_screen`, the answers, the agent's positions and
  Penny's pick see exactly what they saw before. They are read a page at a
  time (`listFullList`, 20 rows) by `GET api/session/[id]/hotels?page=n`, and
  counted for the view (`fullList: { total, more, pageSize }`).
- **Member prices**: the rows come from `ordered`, which never holds a member
  price for an anonymous visitor, and the reads apply the shortlist's own
  audience filter on top (tested: after sign-in re-ranks with member offers, a
  public read of the same rows returns none).
- **Opening and booking**: the detail and rates routes used to accept only a
  hotel on the shortlist; they now accept any row this session lists
  (`isListed`), which a malformed id never matches. Checkout already worked by
  offer id and re-checks the rate as before.
- **The client** (`components/useFullList.ts`) pages with Previous / Next; the
  rows are compact cards (no photo, no reason line) that open and book like the
  others. Any new ranking writes new rows, so the top picks' ids change and the
  page is read again.
- **Keeping the place over a new search** (2026-11-14). Scrolled down the full
  list, a change that searches again (the currency) came back at about hotel
  10: the new ranking's page holds no rows until it is read, the scroller
  clamped to the top picks, and only Chromium's scroll anchoring sometimes put
  it back (Safari has none). `components/useKeepPlace.ts` holds the section's
  height while the page loads, then puts the hotel that was at the top of the
  view back at the same height, or keeps the scroll position when this page no
  longer holds it (`lib/keepPlace.ts`). Paging is untouched: Previous / Next
  still go to the top of the list. Test: `e2e/ui/full-list.spec.ts`, with
  `overflow-anchor: none` so Chromium cannot repair it.
- **Chat**: Jev's `more` intent now also covers "the whole list of every hotel
  found"; code then reads `wantsWholeList` (as `map` reads `wantsMapHidden`):
  "show me all of them" opens the list, "show me some other options" still sets
  the shown ones aside. The agent has `show_all_hotels`. Both answer with a
  line counted from the rows (`fullListLine`).

Tests: `lib/fullList.test.ts`, `test/pg/finder.test.ts` (order against the raw
offers, filters, member prices, paging, `isListed`, the view), turn and agent
tests in `test/pg/`, `e2e/full-list.spec.ts`. Mutation checks: 13 for the server
and router, all caught (one only after the agent test gained a change queued
with `show_all_hotels`).

The supplier is asked for up to 200 hotels (`MAX_HOTELS` in
`server/finder.ts`; 30 until the public-price change made it safe, measured on
the constant), so the list runs to several pages, and a city's pool reaches its
suburbs ("In the city", below).

## Room splits (2026-11-13)

Vio's "optimise for best price": when the user has not said how many rooms,
we choose. `stays.rooms` is null until they do (form, trip box, the Who chip
and set_guests all start at "Best price"; a number fixes it, and "−" from 1
goes back to "Best price").

- **Which splits** (`lib/finder/rooms.ts`, pure): room counts from the fewest
  (rooms of up to four people) to the most (one room per two adults, or per
  three people when children make the party bigger; never more rooms than
  adults, never more than 6), at most three of them. The party is spread by
  `splitParty` as before: adults evenly, children with the first rooms, an
  adult in every room. A couple, alone or with one child, is one room and one
  search: nothing changed for them. 3–4 adults or a family of four: 1 and 2
  rooms. 5–6 adults: 2 and 3. Twelve: 3, 5 and 6.
- **Fetch**: one rate search per split, side by side; the radius widening is
  decided on what all splits found together. A split that fails is left out;
  only all failing is a supplier error. Static facts stay one call.
- **Rank**: one candidate per hotel, its cheapest combination across splits
  (`cheapestPerHotel`): a rate an anonymous visitor may be sold beats a member
  price, then the lowest total plus what is paid at the hotel (two rooms can
  pay the city tax twice), then fewer rooms. The ranking itself is unchanged.
- **Shown**: the offer row keeps the rooms priced (`offers.rooms`) and says
  them in `room_name` ("2 rooms: 2 × Vincci Room", "2 rooms: Vincci Room
  (2 adults) + Vincci Room Uso Individual (1 adult)"), so the card, the
  detail, Penny's context, answers and the receipt all say the same thing.
  The card shows the line whenever the price is for several rooms or we chose.
- **Detail rates** are fetched for the card's rooms only (one search, not one
  per split); rates held for another split of the party are not reused.
- **Checkout** books exactly the card's rooms: the prebook's rooms (who is in
  each, in order) must equal the offer's, or it is `rate_gone` and nothing is
  written; the booking is named as the prebook holds them and `book` gets one
  guest per room.

Measured on the recordings (the 20 Porto hotels, 11–13 Dec, public margin):
4 adults as one room, 6 hotels priced it; as two rooms, all 20; two rooms
were cheaper at 5 of the 6. A family of 2 + 2 (4 and 9): one room at 9
hotels, two rooms at all 20, one room cheaper at 3 of the 9. No recorded
hotel's choice flips when the pay-at-hotel charges are counted; the rule is
pinned by a unit test instead.

**Anonymous visitors, found while measuring:** in every multi-room search
recorded on 2026-11-13 (and the 4-adult one-room search), every public rate
was a few cents under the hotel's suggested public price (e.g. €459.41 vs
€459.46), so the public-price rule hid all of them from an anonymous visitor:
they see near-misses only. A couple's search the same day: 4 of 20. This is
the sandbox's pricing meeting an existing rule, not the splits (a user's own
"2 rooms" was already affected). The "Open" note above (show them at the
public price) is the fix; not built. The e2e spec signs in for that reason.

Mutation checks: 18, 17 caught after one test was added (checkout keeping the
card's name). The survivor: the finder ignoring pay-at-hotel charges, which
no recording can reach (above); `rooms.test.ts` catches it in the pure function.

## In the city (2026-11-14)

Reported on the live site: "cheap and well rated" in Madrid, no place named,
put Valdebebas and Alcobendas (11–14 km out) in the top five; in Lisbon, Crowne
Plaza Caparica, 10.6 km out across the river. Reproduced on two searches
recorded the way the app makes them (`rates-city-madrid`, `rates-city-lisbon`:
place id, 200 hotels, `--add-far-cities`): Madrid's top five held INNSiDE
Valdebebas (10.9 km) first and Hampton Alcobendas (14.3 km) fifth; Lisbon's held
the Crowne Plaza second; "cheapest" alone in Madrid was all airport, Coslada and
San Sebastián de los Reyes. Nothing in the ranking was wrong: distance is not a
metric of cheapest + nicest, and with 200 hotels the place-id search reaches
the suburbs.

**The rule**: when distance is measured from the middle of the results (a
city, no place named, no sights), a hotel farther from that middle than the
**city bound** does not fit. The bound is `max(8 km, 4 × the median hotel's
distance)` over every hotel the search returned (`CITY_BOUND_MIN_KM`,
`CITY_BOUND_SPREAD`, `cityBoundKm` in `finder/rank.ts`), on the 100 m steps the
card shows.

Measured on the sandbox the same day, 200 hotels a city, 11–13 Dec:

| City | Median hotel | Bound | Kept at the edge | Cut |
|---|---|---|---|---|
| Madrid | 1.3 km | 8 km | Mirasierra 7.2 | Feria 8.2, Barajas/airport 9.4–12.8, Valdebebas 10.9, Alcobendas 13.8–14.2, S. S. de los Reyes 16.5 |
| Lisbon | 1.1 km | 8 km | Oriente 6.0–6.6, airport 7.6 | MS Aparthotel 8.9, Caparica 10.7–11.9, Santa Iria 14.1 |
| Porto | 0.9 km | 8 km | Foz 6.2, Matosinhos 7.1–7.7 | Exponor 8.3, Maia 9.7, airport 10.3–11.0 |
| Barcelona | 1.3 km | 8 km | Cornellà 7.8 | Badalona 8.1, El Prat/airport 8.2–12.1 |
| Paris | 2.2 km | 8.8 km | La Défense 7.3 | Orly 15.2 |
| London | 3.4 km | 13.6 km | Wembley 12.1, ExCeL 10.4–11.8 | Croydon 14.7, Heathrow 16.8–22.6, Watford 25 |
| Berlin | 3.1 km | 12.4 km | Spandau 12.1 | Adlershof 13.3, BER 15.1–18.3, Potsdam 25 |
| New York | 1.3 km | 8 km | Downtown Brooklyn 6.2–7.1 | Red Hook 8.1, LaGuardia, Flushing, JFK, Newark, Yonkers |

A fixed 8 km alone would have cut 32 of London's 180 hotels (Canary Wharf's
edge, Greenwich, Stratford) and 24 of Berlin's; the multiple of the median lets
a spread-out city keep its districts while a compact one stops at the river.

- **Why a hard constraint, not a weight.** Ranking stays as it was: one
  priority lexicographic, two or three an equal-weight sum of percentiles, none
  the balanced score. The bound only decides what fits, before ordering, so the
  dominance property holds unchanged (a dominating hotel is no farther, so it
  is never out when the other is in), and the order is the same for any
  priorities; changing priorities never changes how many hotels fit.
- **Why in `rankStay`, not at fetch time.** A radius search around the city's
  map point was the other way. Rejected: the map point is not the middle
  (Porto's is 1.8–2.3 km off, `searchPlan.ts`), one radius does not fit both
  Lisbon and London, and hotels dropped by the supplier could never be shown as
  a near miss or counted.
- **Not applied** when the user named a place or planned sights (that search
  is already a radius around it), when a brand is asked for (the hotels of that
  brand are what was asked for, wherever they are: Crowne Plaza in Lisbon is
  Caparica), or to a hotel with no position (not known to be out).
- **Near misses**: `out_of_town` is a miss like the others, with the hotel's
  distance and the bound (`{ kind: 'out_of_town', km, max_km }`), counted as
  `rejected.out_of_town`. When fewer than five fit (a tight cap), the cheapest
  out-of-town hotels under the cap fill the list under the divider, saying
  "out of town, 9.4 km from the middle of the results (a city search keeps to
  8.0 km)". When none fit, the chat line says how many were out of town. The
  far hotels are still fetched and stored, so the count is honest.
- **Personas**: the oracle gained the rule, written from the raw points. It
  cuts none of the 20 recorded Porto hotels (all within 3 km of the middle), so no persona's
  expected pick changed; a test pins that.

Tests: `finder/cityBound.test.ts` (both recordings, every set of priorities,
against an oracle from the raw points; near misses under a cap; the
exemptions), `finder/rank.test.ts` (the bound's arithmetic, the shown-number
edge, unknown positions, 400 random cities with suburbs for dominance),
`test/pg/finder.test.ts` (Madrid signed in and out, Lisbon, the near-miss rows
as stored), copy in English and Spanish, `e2e/ui/city-bound.spec.ts` (Madrid on
the live sandbox, desktop and 390×780). All of these failed before the change.

Mutation checks: 12, all caught (bound never applied; applied with a place
named; applied with a brand; exact distance instead of the shown one; no floor;
no spread; `out_of_town` miscounted as a must-have; a hotel with no position
counted as out; mean instead of median; `>=` for `>`; the card's words; the
chat's words).

Open for Sam: whether a brand should be exempt (an NH filter in Madrid would
again admit an airport NH, though none is in today's list); whether the floor
should be a setting like the margin; airport hotels in a city search are now
cut, so "near Madrid airport" has to be named (it is then a radius search).

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
  under the hotel's suggested public price.
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
- **Margins** are settings (`PUBLIC_MARGIN_PCT` 15, `MEMBER_MARGIN_PCT` 3 by
  default), not constants.

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

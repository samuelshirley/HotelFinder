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

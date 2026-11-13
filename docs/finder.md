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

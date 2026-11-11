# Onboarding redesign (proposal)

2026-11-11. **A proposal, not built.** Nothing in `src/` has changed. Sam
reviews this first. Each section says what changes, what the user sees, and
which tests prove it.

## 0. The verdict and the target

The current form asks five questions in a fixed order: destination → dates →
guests → nationality → priority (`src/server/onboarding.ts`, `FIELDS`). Two of
them are wasted. Nationality can be inferred. Dates and guests are one thought
("when, and who"). The priority chips are poor: four single-choice labels
("Lowest price / Location / The nicest / Just a decent bed"). "Location" has no
target, and "Just a decent bed" ranks the same as "Lowest price" on the
recording we test against (see §5.1).

**New flow: at most three question cards, and often zero or one.**

| # | Card | Asked when | Skipped when |
|---|---|---|---|
| 1 | **Where to?** | always, unless the place resolves to exactly one area (§1) | the first message names a place that resolves unambiguously |
| 2 | **When, and who's going?** (dates + party + pet, one card) | dates are not fully known | the scan gave valid check-in AND check-out AND the party |
| 3 | **What matters most?** (multi-select + free text) | no priority known | the scan gave priorities; or the user taps "No preference" |
| — | Nationality | **never asked** | inferred; an editable chip in the results header (§4) |

Interactions to the first results for a plain "Annecy" opener: **5 → 3** (one
tap on Q1 only if ambiguous, one submit on Q2, one tap on Q3). For a first
message that states place, dates, party and priority, it drops to zero.

## 1. Q1: Where to?

- **Copy**: `Where to?` Input placeholder: `A city, neighbourhood, airport or station`.
- **Control**: the composer (free text, as now) plus place chips from
  `/api/places` as the user types (as now).
- **Free text**: unchanged path. `onboardingTurn` runs the intent scan
  (`scan.ts`), then `searchPlaces(destination)`.
- **New: auto-pick when unambiguous.** Today every place is "Which one?",
  even "Annecy". Rule, a pure function over the supplier's `types` (no model,
  no ranking by supplier order):
  1. Drop candidates whose types include `lodging` or `hotel`.
  2. If exactly one remaining candidate is an *area* (`locality`,
     `postal_town`, `administrative_area_level_*`, `sublocality*`,
     `neighborhood`), pick it.
  3. Else, if there are no areas and exactly one *point* (`airport`,
     `train_station`), pick it.
  4. Else ask `Which one?` with the filtered chips (as now).

  Measured in the sandbox today:

  | Query | Candidates (types) | Rule result |
  |---|---|---|
  | `Annecy, France` | Annecy (locality); Annecy (train_station); a hotel; 2 offices | **auto: Annecy** (one area) |
  | `Barcelona airport` | BCN (airport); Barcelona Airport Hotel (lodging); T1 (transit_stop) | **auto: BCN** (no area, one airport) |
  | `Lisbon` | Lisbon PT; Lisbon Airport; Lisbon OH; Lisbon ND; Lisbon ME | **ask** (four localities) |

  The picked place is shown at once as the first line (`Annecy, France ·
  change`), so a wrong pick costs one tap. **Decision for Sam**: this relaxes
  the comment in `turn.ts`, "always picked by the user". The pick is still
  made by code over supplier data, never by a model.
- **Default if skipped**: none. The search cannot run without a place.
- **Server validation**: `{field:'destination', placeId}` (the client's
  `label` is dropped). The server calls the new `supplier.getPlace(placeId)`
  (LiteAPI `GET /data/places/{placeId}`, measured to return `displayName`,
  `countryCode`, `location`, `viewport` and `types`) and stores the label,
  country, point and kind from the supplier response. A placeId the supplier
  does not resolve → `place_unavailable`.

## 2. Q2: When, and who's going?

- **Copy**: `When, and who's going?`
- **Control**: one card. Check-in and check-out dates; steppers for Adults
  (shown at **2**), Children (with an age select each), Rooms; checkbox
  `Bringing a pet`. Button: `Show hotels` if priorities are already known,
  else `Next`.
- **Prefill from the scan** (prefill only; nothing applies until the button
  is pressed). Today `validateScan` drops a date unless it can form a full
  range, so "next Friday" and "3 nights in March" are lost and the picker
  opens on today+14. Change: `ScannedTrip` gains three prefill-only fields:
  `checkInOnly`, `nights`, `month` (YYYY-MM). The card opens on that month
  with that length. Example: `3 nights in March` opens March 2027 with check-out
  following check-in by 3 nights.
- **"Next Friday"** is ambiguous on Wednesday 11 Nov (13th or 20th). Add one
  rule to the scan's SYSTEM prompt: `"next <weekday>" is that weekday in the
  following Monday-start week; "<weekday>" or "this <weekday>" is the
  nearest one`. The date is only a prefill, so the user sees `Fri 20 Nov` and
  can change it.
- **Default party**: 2 adults, 0 children, 1 room, no pet, **shown in the
  card**. This replaces the rule "the default of two adults is never assumed"
  (`guestsAnsweredIn`). The default is no longer silent: the user presses the
  button with it visible, and it stays visible as `2 adults ✎` in the header.
- **Free text while Q2 is open**: the composer stays disabled (as now:
  `use_the_form`). Dates in prose are better entered in the picker. Rescanning
  costs a model call and buys nothing.
- **Default if skipped**: cannot be skipped. The dates are prefilled
  (today+14 → +16 with no scan), so it takes one press.
- **Server validation**: one payload
  `{field:'trip', checkIn, checkOut, adults 1–12, childrenAges[≤8] 0–17,
  rooms 1–6, pets}`, `.strict()`. Errors as today: `dates_in_past`,
  `checkout_not_after_checkin`, `stay_too_long`, `more_rooms_than_adults`.

## 3. Q3: What matters most?

### 3.1 Choices

`basic` ("Just a decent bed") is removed. On the Porto recording all 20 hotels
pass its 7.5 / 50-review bar, so it ranked identically to `cheapest` (§5.1).
Multi-select makes it unnecessary anyway: "decent but cheap" is **Low price +
Great reviews**.

| Chip | Key (kept from today) | What it ranks on | Why this wording |
|---|---|---|---|
| `Low price` | `cheapest` | total for the stay | |
| `Great reviews` | `nicest` | guest rating, then review count | It is what we actually measure. "The nicest" promised luxury, which no field answers. |
| `Close to Annecy centre ✎` | `closest` | straight-line km to the target | The target is **in the label**. ✎ changes it (§3.4). |
| `No preference` | (none) | balanced score | Clears the others. Single tap, searches immediately. |

- **Control**: toggle chips (any of the first three, at most three) plus
  `Show hotels`. `No preference` searches straight away.
- **Free text**: the chat composer is **enabled** while Q3 is open.
  Placeholder: `Or say it: near the old town, not too pricey`. The free text
  goes through the turn route, which stays the only free-text boundary.
- **Default if skipped**: `No preference` → balanced (price 0.5, rating 0.3,
  distance 0.2, as now), with distance measured from the destination point
  (§3.4), not from the median of the results. The header shows `Balanced ✎`.
- **Server validation**: `{field:'priorities', priorities: z.array(z.enum(
  ['cheapest','closest','nicest'])).max(3), near?: {placeId}}` with a
  uniqueness check. `[]` = No preference. `near` is only valid with `closest`
  and goes through the same `getPlace` + distance check as §3.4.

### 3.2 Free text → chips (Jev first, Haiku when Jev is not highly confident)

Sam's standing decision. The single `priority` choice question in
`catalogue.ts` becomes four yes/no (`noul`) questions in the same single Jev
request:

| Question | Instruction |
|---|---|
| `wants_price` | The user wants a low price or says price matters. |
| `wants_quality` | The user wants somewhere nice, well reviewed or high quality. |
| `wants_location` | The user wants to be close to something or central. |
| `names_place` | The message names a specific place, area, landmark or venue to be near. |

Settling, with the existing `SETTLE` thresholds and nothing new:
- Every `wants_*` is ≥ 0.8 (yes) or ≤ 0.2 (no), at least one is yes,
  `names_place` ≤ 0.2, `multi_intent` ≤ 0.3 → **Jev settles**. The yes
  answers become the chips. If `closest` is chosen, the target is the default
  (§3.4).
- Anything else → **Haiku**, one forced-tool call `record_priorities`
  (same pattern as `record_trip`): `priorities: enum[]`,
  `near_place: string|null`, `near_place_local: string|null` (the same place
  in the local language, e.g. `Vieille Ville, Annecy`), `must_haves: enum[]`,
  `max_per_night: number|null`. The server validates each field the way
  `validateScan` does.
- `near_place`: the server calls `searchPlaces("<near_place>, <destination
  label>")`, then `near_place_local` if the first returns nothing usable,
  drops lodging, and applies the §1 rule. One result → used. Several → `Which
  one?` chips. None → `closest` keeps the default target, plus the line:
  `Could not find "<text>" in <destination>. Distances are from <default
  label>; tap it to change.`
  **Why two queries, measured today**: `old town, Annecy, France` returned
  only a hotel ("Le Chalet in the heart of the old town"). `Vieille Ville
  Annecy` returned the neighbourhood. `Annecy city centre` and `Annecy
  historic centre` returned nothing. The model writes query **text**. The
  supplier returns the placeId. `getPlace` returns the point. The model never
  authors a coordinate or an id.
- **Shown back**: the answer row reads as the chips, e.g. `Great reviews ·
  Low price · must have pets allowed`. The search runs immediately (no
  confirm step) and the same chips are editable in the results header. A wrong
  reading is one visible, undoable re-rank (R1).

### 3.3 After onboarding

The router's `priority` intent emits `set_priorities` (whole set). Jev
settles it only when the message replaces the set unambiguously ("just the
cheapest"). "Also somewhere nice" (add to the set) and anything naming a place
go to Haiku. The agent gets a `set_near` tool that takes a `place_ref` from
`resolve_place` in the same turn, exactly like `set_destination` today.

### 3.4 Where "close" measures from

**Today**: the destination stores only a placeId. `stays.latitude/longitude`
stay null. `rank.ts` measures from `medianPoint` of the returned hotels, and
the card says "from the middle of the results". That point depends on which
hotels came back. Neither it nor the place pin is necessarily what the user
means.

**Proposal**:
1. **Default target = the destination's own point** from `getPlace`:
   - Area (city, neighbourhood) → label `<name> centre`. Measured: Annecy's
     pin (45.9059, 6.1259) is 18 m from Google's own "Centre Ville"
     neighbourhood point, so the label is earned there. It is 0.73 km from the
     Vieille Ville (45.8996, 6.1285). Lisbon's pin is 1.1 km north of Baixa.
     Hence the ✎.
   - Point (airport, station) → its own name: `Close to Barcelona–El Prat
     Airport`.
   - `medianPoint` survives only as the fallback when `getPlace` fails, with
     the existing honest label.
2. **How it is stated**: in the chip label (`Close to Annecy centre ✎`), in
   the header, and in every distance on a card (`0.4 km from Annecy centre`).
   The card text uses the target's label. "The place you named" and "the
   middle of the results" go away except in the fallback.
3. **How the user names another target**: ✎ opens a small picker:
   - quick chips `<City> centre` (the default), `Main station`, `Airport`.
     Station and airport are resolved only when the picker opens, by
     `searchPlaces("<city> train station" | "<city> airport")` filtered to
     the `train_station` / `airport` type. A chip is shown only if exactly one
     candidate has that type. Measured: `Annecy train station`,
     `Annecy airport`, `Lisbon airport` and `Barcelona airport` each give
     exactly one.
   - a text box (`A neighbourhood, landmark or address`) on `/api/places`,
     with the destination label appended and lodging dropped.
   - free text in chat (`closer to the station`) → Haiku → `resolve_place` →
     `set_near`.

   Every path ends in a placeId the supplier returned → server `getPlace` →
   coordinates. A target more than **50 km** from the destination point is
   refused (`near_too_far`).
4. **The fetch must change when the target is a point.** This is the biggest
   finding. Measured today, BCN airport, 1 night, 2 adults:
   - `POST /hotels/rates {placeId: <BCN airport>}` returned **29 hotels; 1
     within 9 km of the airport**. The median was 12.4 km away in central
     Barcelona (the airport's viewport covers the city).
   - `POST /hotels/rates {latitude, longitude, radius: 6000}` returned **27
     hotels, all within 6.8 km**.

   Rule (pure, in `finder.ts`): if the destination is an area and the target
   is the default, search by `placeId` (as now; Annecy by placeId already
   returns hotels within 4.9 km of the Vieille Ville). Otherwise search by
   `{latitude, longitude, radius: 5000}`, widened once to 15000 if fewer than
   10 hotels come back (one more metered call). Changing the target is
   therefore a **refetch**, not a rerank. `SearchRequest.where` gains the
   lat/lng/radius variant.

## 4. Nationality: inferred, never asked, always visible

LiteAPI refuses a rate search without `guestNationality`
(`rates-error-missing-nationality.json`). Measured today: on 18 Annecy hotels,
1–5 hotels price differently by nationality, deterministically, by about
€1–€30 on 5 nights, occasionally much more. So it matters, but not enough to
spend a question on.

- **Inference**: a pure function `inferNationality({ profile, acceptLanguage,
  ipCountry, destinationCountry })` in `src/lib/nationality.ts`, run once at
  `POST /api/session`. First hit wins:
  1. a signed-in user's **confirmed** `user_preferences.guestNationality`;
  2. the first `Accept-Language` tag with a two-letter region subtag in the
     ISO list (`en-US` → US, `es-ES` → ES; `en`, `es-419` → no answer). This
     comes before IP because language region tracks passport better than
     current location. A US citizen in Girona with an `en-US` browser gets
     US, where IP would say ES;
  3. `x-vercel-ip-country` (absent locally);
  4. no signal → the destination's `countryCode` from `getPlace`, with the
     chip marked as not detected.
- **Stored**: `search_sessions.guest_nationality` (as now) plus a new
  `nationality_source` enum: `profile | locale | ip | destination | user`.
- **Shown**: a chip in the results header, `Nationality for rates: United
  States ✎`. Its editor reads: `Some hotels price by the guest's nationality.
  Choose the passport you'll check in with.` A full ISO country select, with
  the source as a small line: `From your browser language` / `From your
  location` / `From your account` / `Not detected; using France, where you're
  going`.
- **Change**: `set_nationality` (exists; effect `refetch`). The reply line is
  `Rates are now for a <Country> passport.` plus `outcomeLine`. No price
  comparison and no "cheaper/dearer" wording. Signed-in users get a `Use
  this next time` checkbox. Only a ticked box writes `user_preferences`
  (decision 9: only confirmed values are stored).
- **Never chasing a price (structural, not a promise)**:
  - `inferNationality` takes no price, offer or supplier input. A guard test
    fails if `nationality.ts` imports anything from `finder/`, `supplier/`,
    `pricing.ts`, `money.ts` or `repos/offers`.
  - `set_nationality` producers: the inference at session creation, the
    header chip, and the router/agent only when the user states it ("I'm
    German"; the agent tool is accepted only when the user message names a
    country, checked server-side). A guard test lists
    every call site.
  - The finder fetches with exactly `session.guestNationality`, one value
    per search. A test fails if a dispatch issues two rate searches with
    different nationalities.
  - No copy anywhere suggests trying another nationality (reply-guard term
    list + test).
- **Validation**: `code` must be in an ISO 3166-1 alpha-2 list
  (`src/lib/countries.ts`). The current `/^[A-Z]{2}$/` lets `ZZ` through →
  `unknown_country`.
- **Decision 9 amendment** (architecture.md §2): nationality from a profile
  is applied without a confirming question, because it is always visible and
  one tap to change. Everything else in decision 9 stands.

## 5. Ranking for combined priorities

### 5.1 Model

`RankInput.priority: PriorityKey | null` becomes `priorities: readonly
PriorityKey[]` (a set: order of selection must not matter).

| Selected | Order |
|---|---|
| none | `balancedOrder` as today (min-max, 0.5 / 0.3 / 0.2), from the default target |
| one | **today's lexicographic chain, unchanged** (`ORDER[key]`). All existing single-priority persona assertions keep passing. |
| two or three | **equal-weight rank-percentile score** over the selected metrics, then a tie-break chain |

Rank percentile for metric *m*: `(hotels strictly better on m + (ties − 1) / 2)
/ (eligible − 1)`, 0 = best. Distance uses the 100 m-rounded km (the
dominance fix in `finder.md`). Unknown values are worst. Score = sum over the
selected metrics; lower is better. Unselected metrics have weight 0.
Tie-break: the selected metrics in canonical order `cheapest, nicest,
closest`, then the unselected ones, then review count, then `offerId`.

Why percentile and not min-max: one €900 suite would compress everyone
else's price spread and silently turn "low price + great reviews" into "great
reviews". With percentiles, adding a hotel that is worst on everything
cannot change the order of the rest (§5.3 test). Why it stays dominance-safe:
a dominating hotel has a percentile ≤ on every metric, so a score ≤, and an
equal score falls to a chain that ends in all four metrics.

Computed in Python today from `rates-city-porto.json` (member rates, near =
Ribeira). This is a preview; the test oracle decides:

| Selected | Top pick | Note |
|---|---|---|
| Low price + Great reviews | Mercure Porto Centro Aliados (€159, 9.2) | **ties** Hotel Spot Family Suites at 0.684; the tie-break (price first) decides |
| Low price + Close | Hotel Carris Porto Ribeira (€144, 0.1 km) | |
| Great reviews + Close | ICON Duplo Ribeira (9.8, 0.2 km) | |
| All three | ICON Duplo Ribeira | |
| old `basic` | YOTEL Porto | equals `cheapest`: every hotel passes 7.5 / 50 |

**Reason for the top row**: new kind
`{ kind: 'best_mix', of: PriorityKey[], km: number|null, to_label: string|null,
rating: number|null, reviews: number|null, price_rank: number, eligible: number }`.
`reasonText`: `Best mix of low price and great reviews: rated 9.2, 7th
cheapest of 20`. No currency amount. `closest` and `best_balance` gain
`to_label`. Runner-up reasons are unchanged.

### 5.2 Persona changes (`personas.ts`, `personas.test.ts`)

- `Persona.priority` → `priorities: PriorityKey[]`; add `nearLabel`.
- **18 single-priority personas**: `[x]`, assertions untouched. This proves
  single-select did not regress.
- **`light-sleeper`, `wheelchair-user`** (were `basic`) → `['cheapest',
  'nicest']`. Their oracle moves to the combined oracle. The old assertion
  could not tell `basic` from `cheapest` on this recording.
- **`late-flight`** (`closest`, no `near`): today its top pick is **not
  checked at all** (the oracle branch needs `near`). With the default target
  it gets the Porto pin from a recorded `getPlace` fixture and a real
  assertion.
- **`undecided`**: `distanceFrom` `'search_centre'` → `'destination'`.
- **New, judged by the oracle and pinned by name in "picks a person would
  recognise"**:
  1. `close-and-nice` `[closest, nicest]` near Ribeira → ICON Duplo Ribeira.
  2. `cheap-and-close` `[cheapest, closest]` near Ribeira → Hotel Carris Porto Ribeira.
  3. `nice-not-crazy` `[nicest, cheapest]` → Mercure Porto Centro Aliados (pins the tie-break).
  4. `all-three` near Ribeira → ICON Duplo Ribeira.
  5. `dog-nice-value` `[nicest, cheapest]` + `pets_allowed` (example 3's shape).
  6. `airport-cheap` `[cheapest, closest]` near OPO on a **new recorded**
     radius search `rates-radius-porto-airport` (captured by
     `capture-liteapi-fixtures.mjs`, never hand-written).
  7. `close-and-nice-reversed` = 1 with `[nicest, closest]`: same list.

  Count 20 → 27; the "there are twenty" test becomes 27.
- **Combined oracle**: written in the test from the raw recording (its own
  percentile and rounding code). It does not call `rankStay` helpers, the same
  rule the must-have oracle follows today.

### 5.3 Other tests

- **Dominance** (`rank.test.ts`): loop all 8 subsets of the three keys, 400
  random searches each.
- **Purity**: shuffled candidates AND permuted `priorities` give the same
  ranking.
- **Irrelevant alternative**: add a hotel that is worst on every metric. The
  order of the others must not change for any subset. This kills a min-max
  mutation.
- **Fetch rule** (`finder.test`): area + default target → `placeId`;
  airport destination or user target → lat/lng radius; fewer than 10 → one
  widened call; changing the target → `refetch`.
- **Mutation checks to run**: selection order changes the result; non-zero
  weight on an unselected metric; exact km in the percentile; tie-break chain
  missing reviews; min-max instead of percentile; target ignored (median
  used); `best_mix` reported as a single-priority reason; auto-pick choosing
  among two localities; nationality inferred after the search (with a price in
  scope).
- **Router**: `route.test.ts` cases for each `wants_*` combination,
  `names_place` deferral, and a partial reading deferring. `jev.test.ts`
  question-key list updated. `scripts/jev-live.sh` gains "close and nice",
  "cheap near the station", "nice but not crazy expensive" (still never run
  live: Jev's multi-noul accuracy is unmeasured).
- **Scan**: `validateScan` tests for `priorities[]`, `near_place`, and the
  prefill-only `checkInOnly` / `nights` / `month`.

## 6. What changes where (for the build, later)

| Area | Change |
|---|---|
| `onboarding.ts` | `FIELDS = ['destination','trip','priorities']`; new payloads; auto-pick; `getPlace` on destination |
| `lib/nationality.ts`, `lib/countries.ts` | new; pure |
| `api/session` POST | infer nationality from headers + profile |
| `api/session/[id]/edit` | **new route**, one Zod schema: the UI-producible actions (`set_nationality`, `set_priorities`, `set_near {placeId}`, `clear_near`, `set_guests`, `set_dates`). CLAUDE.md route list updated. |
| `store/actions.ts` | `set_priority` → `set_priorities`; `set_near` in two schemas: **producer** `{placeId}` (no coordinates; Jev, Haiku, UI) and **resolved** `{placeId, label, latitude, longitude}` built only by dispatch from `getPlace`; `clear_near` |
| `supplier` | `getPlace(placeId)` (meter op `liteapi:place`, recorded fixtures for Annecy, Porto, BCN, Vieille Ville); `where` gains lat/lng/radius |
| `rank.ts` | `priorities[]`, percentile scorer, `best_mix`, `to_label`; drop `basic` |
| `catalogue.ts` / `route.ts` | four nouls replace the `priority` choice |
| `scan.ts` / `scannedTrip.ts` | `priorities[]`, `near_place(_local)`, prefill fields, "next Friday" rule; new `record_priorities` tool |
| schema | `search_sessions.priorities priority[] NULL` (null = not asked, `{}` = no preference), migrate `basic` → `{cheapest,nicest}`, drop `basic` from the enum; `nationality_source`; `stays`: `dest_latitude`, `dest_longitude`, `dest_country`, `dest_kind`, `near_label`, `near_place_id`, `near_source` (`latitude`/`longitude` stay the near point); `user_preferences.priorities` |
| `FormControl.tsx` | `Trip` card (merged), `Priorities` toggles + `NearPicker`; drop `Nationality` |
| `ChatPanel.tsx` | composer enabled for `destination` and `priorities` |
| `ResultsPanel.tsx` | header chips become controls: nationality, target, priorities, party, dates |
| `replies.ts` | `PRIORITY_LINE` → set wording (`Ranked for low price and great reviews.`), nationality line, near line |
| `errors.ts` | new codes below |
| `architecture.md` | decision 8 superseded (multi-select + target); decision 9 amendment (§4) |

**New error codes, each with copy (errorCopyGuard):**

| Code | Copy |
|---|---|
| `unknown_country` | `That country is not in the list. Pick it from the menu.` |
| `place_unavailable` | `The place lookup did not answer. Try again in a moment.` |
| `near_too_far` | `That place is too far from where you are searching. Start a new search there instead.` |
| `near_needs_closest` | `A place to be near only applies with "Close to". Tap it first.` |

Invariants kept: no price in prose (`best_mix` uses rank ordinals; nationality
lines never compare prices); the model never authors coordinates or ids (query
text only; placeId from the supplier, point from `getPlace`); a staged yes
still calls nothing (onboarding stages nothing; chip edits are typed actions
with no model); every route takes one Zod schema; every new code has copy.

## 7. Before / after

Today is Wednesday 11 Nov 2026. "Before" is the code as it stands, with the
scan running (the Anthropic key is now set). Place candidates and search
counts are the sandbox measurements above. `<km>`, `<r>`, `<n>`, `<M>` come
from the real search and are not guessed here.

### 7.1 "Annecy, 1–6 Dec, just me"

**Before** (3 taps after the message)
```
U  Annecy, 1–6 Dec, just me
A  Which one?  [Annecy, France] [Annecy, Place de la Gare, Annecy, France]
               [Annecy, france, Rue Saint-Maurice, …] [France Travail, …] [France Travail, …]
U  Annecy, France
A  From your message: 1–6 Dec, 5 nights · 1 adult.
A  Which country do you live in? Rates depend on it.  [Spain] [Portugal] … [Another country…]
U  United States
A  What matters most?  [Lowest price] [Location] [The nicest] [Just a decent bed]
U  Location
A  N of M hotels fit. …   card 1: "Closest: <km> from the middle of the results"
```
**After** (1 tap)
```
U  Annecy, 1–6 Dec, just me
A  Annecy, France · 1–6 Dec, 5 nights · 1 adult.            (auto-picked: the only locality)
   What matters most?  [Low price] [Great reviews] [Close to Annecy centre ✎] [No preference]
   (composer: "Or say it: near the old town, not too pricey")
U  "close to the old town but nice"   → Jev: names_place = yes → Haiku record_priorities
                                        {priorities:[closest,nicest], near_place:"old town",
                                         near_place_local:"Vieille Ville, Annecy"}
                                        → "old town, Annecy, France": only a hotel, dropped
                                        → "Vieille Ville, Annecy": one neighbourhood → used
A  Great reviews · Close to Vieille Ville
A  N of M hotels fit. The best 5 are on the right, each with the reason it is there.
   header: Annecy, France · 1–6 Dec · 1 adult ✎ · Nationality for rates: United States ✎
           · Close to Vieille Ville ✎ · Great reviews
   card 1: "Best mix of great reviews and closeness: <km> from Vieille Ville, rated <r>"
```
(Tapping two chips instead of typing: 2 taps, no model call.)

### 7.2 "somewhere cheap near Barcelona airport next Friday for 2"

**Before** (4 interactions; "near the airport" is lost)
```
U  somewhere cheap near Barcelona airport next Friday for 2
   scan: destination "Barcelona airport", 2 adults, priority ONE of cheapest/closest;
         check_in with no check_out or nights → dates dropped
A  Which one?  [Barcelona Airport (BCN), El Prat de Llobregat, Spain] [Barcelona Airport Hotel, …] [Barcelona Airport T1, Spain]
U  Barcelona Airport (BCN), …
A  From your message: 2 adults · lowest price first.
A  Which nights?   (picker on 25–27 Nov)
U  20–21 Nov
A  Which country do you live in? …
U  Spain
A  search by the airport's placeId: measured, 28 of 29 hotels are 9+ km from the airport
   (median 12.4 km, central Barcelona). Card 1 is the cheapest of those: "Cheapest available"
```
**After** (1 press)
```
U  somewhere cheap near Barcelona airport next Friday for 2
   scan: destination "Barcelona airport", priorities [cheapest, closest],
         checkInOnly 2026-11-20, 2 adults
A  Josep Tarradellas Barcelona–El Prat Airport · 2 adults · Low price · Close to the airport.
   When, and who's going?   [Fri 20 Nov] → [Sat 21 Nov]   Adults 2  Children 0  Rooms 1  [ ] Bringing a pet
   [Show hotels]
U  (presses Show hotels)
A  search by lat/lng, 5 km radius (measured at 6 km: 27 hotels, all within 6.8 km)
   header: … · Nationality for rates: Spain ✎ (from location) · Close to BCN airport ✎ · Low price
   card 1: "Best mix of low price and closeness: <km> from Barcelona–El Prat Airport, <n>th cheapest of <M>"
```

### 7.3 "Lisbon with my wife and the dog, nice but not crazy expensive, 3 nights in March"

**Before** (4 interactions; budget sense lost; picker opens in November)
```
U  Lisbon with my wife and the dog, nice but not crazy expensive, 3 nights in March
   scan: Lisbon, 2 adults, pets_allowed, priority nicest (one value); month alone → no dates; nights dropped
A  Which one?  [Lisbon, Portugal] [Lisbon Airport (LIS), …] [Lisbon, OH, USA] [Lisbon, ND, USA] [Lisbon, ME, USA]
U  Lisbon, Portugal
A  From your message: 2 adults · pets allowed · best rated first.
A  Which nights?   (picker on 25–27 Nov; user pages to March)
U  12–15 Mar
A  Which country do you live in? …
U  Portugal
A  best rated first: the top-rated pet-friendly hotel whatever it costs
```
**After** (2 interactions)
```
U  Lisbon with my wife and the dog, nice but not crazy expensive, 3 nights in March
   scan: Lisbon, 2 adults, pets_allowed, priorities [nicest, cheapest], nights 3, month 2027-03
A  Which Lisbon?  [Lisbon, Portugal] [Lisbon, OH, USA] [Lisbon, ND, USA] [Lisbon, ME, USA]
U  Lisbon, Portugal
A  Lisbon, Portugal · 2 adults · pets allowed · Great reviews · Low price.
   When, and who's going?   (picker open on March 2027, 3 nights; Adults 2; [x] Bringing a pet)
U  picks 12 Mar → 12–15 Mar, 3 nights → [Show hotels]
A  N of M hotels fit. …
   card 1: "Best mix of great reviews and low price: rated <r>, <n>th cheapest of <M>"
```
No price cap is invented from "not crazy expensive": the message gives no
number, so the scan leaves `max_per_night` null. "Low price" in the mix
carries it.

## 8. Not verified

- Jev's accuracy on the four new nouls: Jev has never been called live from
  this project. `jev-live.sh` must run before §3.2 ships.
- The Porto picks in §5.1 come from a Python calculation on the recording,
  not from `rank.ts`. The oracle in the tests is the authority.
- Cost of `getPlace` and of the radius widening: metered as `liteapi:place`
  and `liteapi:search`; measured in build step 11.
- The sandbox place search and radius results above were captured on
  2026-11-11. Production inventory may differ; the rules do not depend on the
  exact numbers.

## 9. As built (11 Nov 2026), where it differs from the proposal above

- **Default "close" for a city is the middle of the returned hotels, not the city's map point.** Measured on the recordings: Porto's map point is 1.8–2.3 km from Aliados, the Sé and Ribeira; the median of its 20 hotels is 0.3–0.5 km from them. Annecy: 0.73 km vs 0.56 km from the old town. The map point is kept on the stay (`dest_latitude/longitude`) and used for airports and stations (radius search), and to refuse a "near" place more than 50 km away. The chip says "Close to central Porto".
- **Stale offers fixed.** Reproduced first (`finder.test.ts`, "a new search replaces the old one"): after any refetch (dates, guests, nationality, place), the previous search's still-live offers were ranked alongside the new ones, so old-date prices could top the new shortlist. `listLiveOffersForRanking` now returns the latest search only.
- **Migrations stay additive.** `priority` columns and enum are kept (never written; a guard enforces it); `priorities priority_key[]` is new, and the migration carries old values over (`basic` → `{cheapest, nicest}`).
- **Countries** come from a recorded `/data/countries` answer; `src/lib/countries.ts` is checked against it, so `ZZ` is refused.
- **Not built yet:** the auto-pick of an unambiguous destination and the merged When/Who card (both wait on `docs/entry-ux.md`), and free text on the priorities card going through Jev → Haiku (the composer is still disabled during onboarding).

# Entry UX: the first screen (recommendation)

2026-11-11. **A recommendation, not built.** Nothing in `src/` changed. It
amends `docs/onboarding.md` (§5 below says exactly where). Raw click logs:
`docs/competitor-flows/<site>-<flow>.csv`, walked by hand in Chrome on
2026-11-11 from Girona (EUR, es-ES storefronts, English UI).

## 0. Verdict

**Yes: replace the one-question-at-a-time opening with a compact trip box.
But don't build a vio clone of it.** It is one sentence box with three
pills under it (Where · When · Who) and optional "what matters" chips. You
can type the whole trip in one line, or fill the pills like a normal search
widget, or mix the two. Chat only asks a follow-up when something is truly
missing or ambiguous (which Lisbon, which day in March). Nationality is never
asked. The three onboarding cards stop being steps:
- **Where** becomes the box.
- **When/Who** become pills.
- **What matters** becomes optional chips on the first screen and the results header.

Why: every competitor collects place, dates and party in one row before
anything else (§1). Users expect it. Asking the same things one at a time in
chat is slower than what they already know. Booking.com already ships "Search
in your own words" inside its widget, so free text is not our edge. **The edge
is the output: one ranked pick with the reason, where competitors give
100–779 results and a sort menu.** The first screen has to show that.

## 1. What competitors do (observed)

### 1.1 First screens

| Site | Fields, in order | Prefilled | Other |
|---|---|---|---|
| **vio.com** | `Where are you going?` · check-in · check-out · guests, one row, search icon | dates **tonight → tomorrow** (Nov 11–12), **2 adults**; rooms "Optimize for best price" (default) or manual | Headline "Book like an insider". App-store + Trustpilot strip. Remembers the last search and prefills it on the next visit (stale values carried into the next trip). |
| **hotels.com** (redirects to es.hoteles.com) | `Where are you going?` · one dates field · `2 people, 1 room` · `Look for` | dates **next weekend Fri 13 – Mon 16 Nov**, 2 adults, 1 room | **Cookie wall first** (EU). "I travel for business" checkbox. Remembers the last search, including filters ("Recent filters: Excellent 9+" followed me from Annecy to Lisbon). |
| **booking.com** | **`Search in your own words`** (placeholder "Family-friendly apartments in Paris that allo[w pets]") · dates · occupancy · Search | dates **empty**, 2 adults · 0 children · 1 room | The hero is a Black Friday flight promo. Natural-language search is in the destination field. Typing a sentence collapses dates and occupancy to icons. |
| **mindtrip.ai** (chat-first) | none on the first viewport | n/a | Hero "Travel that gets you." with one CTA, "Set up your travel assistant" (onboarding before value). Cookie bar. |
| **ours (localhost:3000)** | chat: `Where are you going?`, composer `Type a city or neighbourhood` (`ChatPanel.tsx`) | today+14 → +16 in the dates card | Running. It showed a finished Annecy session: 5 Q&A bubbles in a narrow left column, 4 results on the right. There was a Next.js dev "1 error" toast, which I didn't open. I didn't press New search, to stay out of the other session's data. |

### 1.2 The three flows: totals per site

Interactions = clicks + typing actions + scrolls (READ and WAIT rows are logged
but not counted). A typed sentence counts as one TYPE.

| Flow | Site | Reads | Clicks | Types | Scrolls | → first results | → filtered/sorted to intent | → hotel page | → checkout page |
|---|---|---|---|---|---|---|---|---|---|
| A Annecy, 1–6 Dec, 1 adult, central + well rated | hotels.com | 11 | 18 | 1 | 3 | 10 | 16 | 17 | **22** |
| | vio | 8 | 12 | 1 | 0 | 8 | 11 | 12 | 13 → **Expedia search page** (not checkout) |
| B Lisbon, 2 + dog, 3 nights Mar, nice not pricey | hotels.com | 11 | 20 | 2 | 3 | 11 | 18 | 23 | **25** |
| | vio | 9 | 19 | 3 | 0 | 14 | 20 | 22 | → Expedia / Airbnb hand-off |
| | booking.com (AI) | 3 | 2 | 1 | 0 | **3** (no prices until exact dates) | — | — | not walked |
| C cheap near BCN airport, next Fri, 2 adults | hotels.com | 9 | 15 | 1 | 0 | 10 | 13 | 14 | **16** |
| | vio | 9 | 20 | 2 | 0 | 17 (7 lost to Venezuela) | 19 | 20 | **22** |
| | booking.com (AI) | 3 | 2 | 1 | 0 | **3** | 3 | — | not walked |

### 1.3 Findings that change the design

1. **Nobody combines priorities.** Sorts are single-key: hotels.com has 7,
   vio 6. "Central and well rated" became sort-by-distance plus a hard 9+ (or
   8+) rating cut. That dropped 254 → 90 (hotels.com) and still left the user
   to weigh the result by eye. "Cheap and near the airport": sorting by price
   pushed the near hotels away. On vio, cheapest-first opened at Casa Barcelo
   Camp Nou, by the football stadium, not the airport. vio cards show **no
   distance** at all.
2. **Autocomplete's first row is dangerous.**
   - vio, "Barcelona airport": the only row tagged *Airport* was **Barcelona
     (BLA), Venezuela**. El Prat was not offered. It cost 7 extra interactions
     and a search in the wrong country. Typing "BCN" fixed it.
   - booking.com, the Lisbon+dog sentence: the first suggestion was a
     pet-friendly hotel in **Nice, France**. The AI search row was second.
     For the airport sentence it was sixth.

   This supports Sam's rule: ask unless exactly one match, and always show
   the country and the type.
3. **Booking.com's AI search is the real competitor on input.** One sentence
   plus one click parsed "next Friday" = 20 Nov, 2 adults, airport, Hotels,
   lowest price band. It came back with 540 properties, each showing "400 m
   from Barcelona-El Prat Airport". For Lisbon it parsed pet + "3 nights in
   March". It **dropped "nice but not crazy expensive"** and showed no prices
   until exact dates were picked. Either way it ends in "Our top picks" over
   hundreds of results.
4. **vio is a metasearch.** 2 of 3 flows left vio:
   - "View deal" landed on **expedia.es search results** (not the property,
     not checkout), with a second cookie banner.
   - Clicking a Lisbon card title opened **airbnb.es** and lost the pet.

   Only a "vio rate" deal (Flow C) reached vio's own one-page checkout: 15-min
   price timer, pay-later default, €75.63.
5. **Pets are second-class everywhere.**
   - No widget has a pet field.
   - hotels.com hides "Pets are welcome" behind "See more". Its compare view
     lists breakfast, parking, Wi-Fi and A/C but not pet policy, and checkout
     has no field to declare the pet.
   - The top 3 cards after the pet filter were "Advertisement" and showed no
     pet tag.
6. **Prices move between card and checkout.** hotels.com: €329 member card →
   €363 total at checkout (non-member). €71 → €78.48. The headline number
   needs an account ("Log in to see this price"). Our invariant (re-check;
   show a changed rate) is a real differentiator. Say so.
7. **Ranking honesty is visible.** hotels.com prints "The amount we receive
   affects our ranking." next to the sort, and puts sponsored hotel cards on a
   hotel's own page. vio has "Why results appear this way".
8. **No one asks nationality.** Not in the widget, not at checkout (vio,
   hotels.com). Inference (onboarding §4) matches the market.
9. **Defaults are guesses.**
   - vio: tonight.
   - hotels.com: next weekend.
   - Both carry the previous trip's values into the next search.
   - booking.com leaves dates empty and shows no prices until they are set.

## 2. Recommendation: the first screen (desktop)

### 2.1 Layout

A centred column, max-width 760 px, starting about 22 vh from the top.
Nocturne tokens (`--tp-*`). No hero photo, no deals carousel, no popover,
no cookie wall. The cookie wall is avoidable only while we set no
non-essential cookies; today it is `hf_session` in localStorage plus the
signed anonymous cookie, both essential.

```
 Hotel finder                                                     Your trips
                                                                         
            Not 400 hotels. The right one, and why.                    (H1)
   Tell us the trip. We check every hotel with a room and show the      (sub)
   best three, each with the reason it won.                             
                                                                         
 ┌───────────────────────────────────────────────────────────────────┐   
 │ Annecy, 1–6 Dec, just me, central and well rated▌                 │   (box)
 │───────────────────────────────────────────────────────────────────│   
 │ [⌖ Where: Add a place] [▦ When: Add dates] [☺ Who: 2 adults]      │   
 │                                               [ Find my hotel ]   │   
 └───────────────────────────────────────────────────────────────────┘   
   What matters? (optional)                                              
   [Low price] [Great reviews] [Close to the centre]                     
                                                                         
   Real prices, taxes in  ·  Ranked only by what you asked for  ·        
   Book without leaving the page                                         
                                                                         
   ── Example answer (real search, Porto, recorded) ──                   
   ┌ 1  Mercure Porto Centro Aliados  · 9.2 ·  Best mix of low price ┐   
   │    and great reviews: rated 9.2, 7th cheapest of 20             │   
   └──────────────────────────────────────────────────────────────────┘   
```

### 2.2 Controls and copy

| Element | Exact copy | Behaviour |
|---|---|---|
| H1 | `Not 400 hotels. The right one, and why.` | |
| Sub | `Tell us the trip. We check every hotel with a room and show the best three, each with the reason it won.` | "Every hotel with a room" must stay true for the supplier we query. If not, use "every hotel we can book". |
| Box | placeholder cycles every 4 s, pauses on focus (and stops under `prefers-reduced-motion`): `Annecy, 1–6 Dec, just me, central and well rated` → `Lisbon with my wife and the dog, 3 nights in March, nice but not crazy expensive` → `Cheap hotel near Barcelona airport next Friday for 2` | Autofocus. Grows 1 → 3 lines. Enter submits; Shift+Enter is a new line. Max 1000 chars (as the composer). |
| Place dropdown | rows `Annecy · Haute-Savoie, France · City`, `Barcelona–El Prat Airport · Spain · Airport` | Opens while the box text looks like a bare place (no digit, no month or weekday word, ≤ 4 words). Comes from `/api/places`, lodging dropped, **country and type on every row**. Picking a row fills the **Where** pill and clears the box. |
| Full-text row | `Search for: "<the whole text>"  ⏎` | When the text has more than a place (digit, month/weekday, "for N", "with", "near", "cheap", ...), this row is **first and preselected**, and place rows go under it. This is the lesson from booking.com (Nice first, AI row sixth). |
| Where pill | `Where: Add a place` → `Where: Annecy, France` | Popover: the same place search with a text box. |
| When pill | `When: Add dates` → `When: Tue 1 – Sun 6 Dec · 5 nights` | Popover: a two-month range calendar, footer `Tue 1 Dec – Sun 6 Dec · 5 nights · Done`. Quick chips over it: `This weekend` · `Next weekend`. **No silent default** (vio tonight and hotels.com next weekend are guesses; dates are the one field we can't price without). |
| Who pill | `Who: 2 adults` (default shown), `Who: 1 adult · pet` | Popover: Adults stepper (2), Children stepper with an age select each, `[ ] Bringing a pet`, and `Rooms: 1 · change` (collapsed, like vio's "optimize rooms"). No competitor has the pet in the widget. Ours costs one checkbox and makes a promise the results keep. |
| What matters | `Low price` · `Great reviews` · `Close to the centre` → after a place: `Close to Annecy centre` | Multi-select toggles, optional, max 3. None = Balanced. The near-target ✎ stays a results-header control (onboarding §3.4), not a first-screen one. |
| Button | `Find my hotel` | Disabled only while submitting. Pressed with no place and an empty box → opens the Where popover. With no dates and nothing date-like in the text → opens the When popover. Never an error toast. |
| Trust strip | `Real prices, taxes in` · `Ranked only by what you asked for` · `Book without leaving the page` | Each line is a claim, so each needs a guard (§6). Show line 3 only after booking ships (today the Book button is disabled). |
| Example answer | a real top card from a recorded search, labelled `Example from a real search: Porto` | Shows what you get (one pick plus a reason) before you type. Taken from `rates-city-porto.json` + `rank.ts` output. Never hand-written. |

Nationality is not on this screen (onboarding §4: inferred, editable chip on
results).

### 2.3 After submit

The page becomes today's two-pane app. The left chat shows the user's message
as a bubble (or, for a pills-only search, the line `Annecy, France · 1–6 Dec ·
1 adult · Great reviews, Close to Annecy centre`). The right shows the
ranked shortlist. The trip box **collapses into the results header chips**
(`Where ✎ · When ✎ · Who ✎ · Priorities ✎ · Nationality for rates ✎`), the
same controls onboarding §6 already plans for `ResultsPanel`. The first screen
comes back only on `New search`, and **opens empty**: no previous trip carried
over (vio and hotels.com both leak the last trip's place, dates and even
filters into the next one).

## 3. How free text and the widget coexist

There's one input and one submit, and each source fills what it can:

1. **Pills set by hand win.** The message fills only empty pills. If both say
   something different, the pill wins and the conflict is shown in the summary
   line, not silently resolved.
2. **Text goes through the existing intent scan exactly once** (`scan.ts`,
   `record_trip` + the planned `record_priorities`). That is still the only
   free-text boundary (CLAUDE.md invariant). The route takes one Zod payload
   (`{ field: 'brief', text?, placeId?, checkIn?, checkOut?, adults,
   childrenAges, rooms, pets, priorities }`, `.strict()`). The model converts
   text to typed values; it never sets a value a pill already holds.
3. **A bare place takes the widget path with no model call:** pick a dropdown
   row, set the When pill, press the button. Zero model spend, like vio.
4. **Then the follow-ups.** Each is a chat card and appears only if needed:
   - place ambiguous → `Which Lisbon?` (chips with country);
   - partial dates (month, nights, check-in only) → the date card opened on
     that month with that length;
   - no dates at all → the date card.

   Nothing else is asked before results.

## 4. What moves out of chat

| Today in chat (`FIELDS`) | Goes to | Still in chat when |
|---|---|---|
| destination | the box + Where pill | ambiguous: `Which <name>?` |
| dates | When pill | free text gave a partial date, or none |
| guests | Who pill (2 adults shown) | never |
| nationality | inferred, header chip | never |
| priority | first-screen chips (optional) + header chips | never asked. Free text such as "near the old town" still goes Jev → Haiku → `near_place` (onboarding §3.2) |

Chat keeps: disambiguation, the partial-date follow-up, everything after
results (refine, ask about a hotel, book).

## 5. Changes to the three cards in `docs/onboarding.md`

| Card (onboarding §0) | Becomes | Concretely |
|---|---|---|
| 1 **Where to?** | **Not an opening question.** The box plus the Where pill. The card survives only as the `Which <name>?` disambiguation. | Auto-pick tightened to Sam's rule: **auto only when exactly one candidate is left after dropping lodging**. Decision for Sam: does a same-name station or airport count as a second match when the query names neither? Annecy (locality + train station) and "Barcelona airport" (BCN + T1 transit stop) each cost one tap if it does. I recommend it doesn't: drop points of a type the query didn't name. |
| 2 **When, and who's going?** | **Not a step when the pills are set.** It survives only as the partial-date follow-up. | Prefill-only fields (`checkInOnly`, `nights`, `month`) and the "next Friday" rule stay as written (§2). Party is no longer on this card; it's the Who pill (default 2 adults, visible; same decision as §2). The pet checkbox moves to the Who popover. |
| 3 **What matters most?** | **Never asked in chat.** Optional chips on the first screen, editable in the results header. | Skipped = Balanced, header `Balanced ✎` (as §3.1). `No preference` chip removed (no chip = no preference). Choices, keys, multi-select, Jev nouls and `record_priorities` unchanged. |
| Nationality | unchanged (§4 of onboarding) | |

Update §0's count line. A plain "Annecy" through the widget is: type, pick
row, 2 date taps, button = **5 interactions, 0 model calls**. A full sentence
is **2**: type, send.

## 6. Flow mapping: every competitor step → ours

Columns hold the interactions spent on that step (CSV rows). "Ours" holds
the counts **with the redesign built and booking built as
architecture.md §10 specifies (signed-in OTP before the payment row)**. These
are targets, not measurements.

### Flow A: "Annecy, 1–6 Dec, just me, central and well rated"

| Step | hotels.com | vio | Ours | Becomes |
|---|---|---|---|---|
| Cookie wall | 1 | 0 | 0 | eliminated (essential storage only) |
| Focus box + type place | 2 | 2 | 1 | **one chat message** (the whole brief) |
| Pick place suggestion | 1 | 1 | 0 | **inferred**: one locality left |
| Check-in + check-out | 2 (+1 mis-tap, not counted) | 2 | 0 | **inferred** "1–6 Dec" |
| Party: open, −1, close | 3 | 2 | 0 | **inferred** "just me" |
| Search button | 1 | 1 | 1 | the message's send |
| Dismiss login popover | 1 | 0 | 0 | eliminated |
| Sort: open + "distance" | 2 | 2 | 0 | **inferred** → `closest`, target Annecy centre |
| Rating: scroll, 9+/8+, scroll back | 3 | 1 | 0 | **inferred** → `nicest` (ranked, not a hard cut) |
| Weigh 90 results by eye | READ | READ | 0 | eliminated: `Best mix of great reviews and closeness: 0.4 km from Annecy centre, rated 9.2` |
| Open hotel | 1 | 1 | 1 | still a click (Details) |
| Choose room, rate radio, scroll, Reserve | 4 | — | 1 | still a click: `Book` on the shown rate |
| Payment-timing modal | 1 | — | 0 | eliminated (one Stripe path) |
| Leaves to partner site | — | 1 + restart on Expedia | 0 | eliminated (we are the checkout) |
| Sign in (email, send, code, verify) | 0 | 0 | **4** | **added by architecture decision 3**; see §9 |
| **To ranked results** | 16 | 11 | **2** | |
| **To payment form / checkout** | 22 | 13 + Expedia | **8** (4 with guest checkout) | |

### Flow B: "Lisbon with my wife and the dog, nice but not crazy expensive, 3 nights in March"

| Step | hotels.com | vio | Ours | Becomes |
|---|---|---|---|---|
| Clear the previous trip's text | 0 | 2 | 0 | eliminated (new search opens empty) |
| Type place | 2 | 2 | 1 | **one chat message** |
| Pick place | 1 | 1 | 1 | **still a click**: `Which Lisbon?` (LiteAPI returns Lisbon OH/ND/ME; Sam's rule always asks) |
| Month navigation + 2 dates (+ Apply) | 4 | 5 | 1 | **inferred** March + 3 nights → card opens on March, 3-night length; **one click** on the check-in day |
| Party: open, +1, close/apply | 3 | 3 | 0 | **inferred** "my wife" → 2 adults |
| Pet: scroll, See more, tick / chip | 3 | 1 | 0 | **inferred** "the dog" → `pets_allowed` must-have, pet ticked |
| Price cap: scroll, box, type (, apply) | 3 (+3 failed, not counted) | 3 | 0 | **inferred** as priority `Low price`; no cap invented |
| "Nice": 8+ chip | 0 | 1 | 0 | **inferred** → `Great reviews` |
| Search | 1 | 1 | 1 | `Show hotels` on the date card |
| Dismiss popover | 1 | 0 | 0 | eliminated |
| Compare two: toggle, 2 ticks, Compare / 2 tabs | 4 | 2 | 0 | eliminated: each card already says `Than the first: €x less, y km further, rated z higher`, and the pet rule is a must-have, not a column |
| Open hotel | 1 | 1 (→ Airbnb) | 1 | still a click |
| Room/rate + book | 2 | — | 1 | still a click |
| Sign in | 0 | 0 | **4** | added by decision 3 |
| **To ranked results** | 18 | 20 | **5** | |
| **To payment form / checkout** | 25 | partner hand-off | **11** (7 with guest checkout) | |

### Flow C: "cheap hotel near Barcelona airport next Friday for 2"

| Step | hotels.com | vio | Ours | Becomes |
|---|---|---|---|---|
| Type place (incl. clear) | 2 | 3 | 1 | **one chat message** |
| Pick place | 1 | 1 + 7 recovering from Venezuela | 0 | **inferred**: one airport after dropping lodging (1 tap if Sam counts the T1 transit stop) |
| Month navigation + 2 dates (+ Apply) | 6 | 7 | 1 | **inferred** "next Friday" = Fri 20 Nov (check-in only) → date card prefilled 20 → 21 → **one click** `Show hotels` |
| Party | 0 (carried over) | 0 (carried over) | 0 | **inferred** "for 2" |
| Search | 1 | 1 | 0 | part of `Show hotels` |
| Dismiss popover | 1 | 0 | 0 | eliminated |
| Sort by price (and then distance) | 2 | 2 + 1 | 0 | **inferred** → `[cheapest, closest]`, target = BCN, fetched by radius (onboarding §3.4 item 4) |
| Trade cheap vs near by eye | READ | READ | 0 | eliminated: `Best mix of low price and closeness: x km from Barcelona–El Prat Airport, nth cheapest of M` |
| Open hotel | 1 | 1 | 1 | still a click |
| Choose room + book | 2 | 2 | 1 | still a click |
| Sign in | 0 | 0 | **4** | added by decision 3 |
| **To ranked results** | 13 | 19 | **3** | |
| **To payment form / checkout** | 16 | 22 | **9** (5 with guest checkout) | |

## 7. The streamlined target flows

```
A  [first screen] type "Annecy, 1–6 Dec, just me, central and well rated" ⏎
   → results: Annecy, France · 1–6 Dec · 1 adult · Close to Annecy centre · Great reviews
     card 1: "Best mix of great reviews and closeness: <km> from Annecy centre, rated <r>"
   → Details → Book → (sign-in) → payment row                      2 to results

B  type "Lisbon with my wife and the dog, nice but not crazy expensive, 3 nights in March" ⏎
   → chat: "Which Lisbon?"  [Lisbon, Portugal] [Lisbon, OH, USA] [Lisbon, ND, USA] [Lisbon, ME, USA]
   → tap Portugal → date card opens on March 2027, 3 nights, 2 adults, [x] Bringing a pet
   → tap 12 Mar (→ 12–15) → Show hotels
   → results ranked Great reviews + Low price, pets allowed only     5 to results

C  type "cheap hotel near Barcelona airport next Friday for 2" ⏎
   → date card: Fri 20 Nov → Sat 21 Nov · 2 adults → Show hotels
   → radius search from BCN; ranked Low price + Close to the airport 3 to results

Widget-only (no typing beyond the place), A:
   type "Annecy" → pick row → When: 1 Dec, 6 Dec → Who: −1 → [Close to Annecy centre]
   [Great reviews] → Find my hotel                                  9 to results, 0 model calls
```

## 8. Marketing angle

What the others say on the first screen:
- vio: "Book like an insider"
- hotels.com: "Your next journey starts here"
- booking.com: a Black Friday promo
- mindtrip: "Travel that gets you."

They promise deals or vibes, and all of them then hand over a long list. None
says it will choose.

**One line: `Not 400 hotels. The right one, and why.`**

What keeps it from looking like a vio clone:
- **The input is a sentence, not a form row.** The placeholder is a whole trip
  and the button says `Find my hotel`, not `Search`.
- **The output is shown before the input is used.** One real example card with
  its reason under the fold. No competitor shows a reason.
- **"Ranked only by what you asked for."** This is the direct contrast with
  hotels.com's own disclosure next to its sort ("The amount we receive affects
  our ranking"). Make it structural, not a promise: a guard test that
  `RankInput` and the finder take no commission, margin, provider or ad field.
  It is mutation-checked by adding one.
- **No fake urgency.** "We only have 1 more room at this price" and "This
  option is very popular" both appeared on hotels.com checkouts. Ours shows a
  re-checked total and says when it changed.

## 9. Open decisions for Sam

1. **Guest checkout vs sign-in before paying** (architecture decision 3 /
   §10). Neither vio nor hotels.com requires an account to reach checkout. OTP
   adds 4 interactions to every flow above (A: 8 vs 4). The cost would be
   measured, not guessed: build A both ways and count.
2. **Same-name points as a second match** (§5, card 1).
3. **No default dates** (§2.2). If you want vio-style instant results for a
   bare place, the alternative is "Next weekend" shown in the pill, never
   silent.

## 10. Not verified

- **Our counts are targets.** The redesign, sign-in and booking are not
  built (`docs/build-log.md`). The scan's handling of "just me",
  "my wife", "the dog" and "nice but not crazy expensive" is assumed from
  onboarding §7. Jev and the scan were not run live for these sentences.
- **vio Flow A/B**: walked to the partner hand-off only. The Expedia
  checkout (about 5 more interactions on the hotels.com platform) was not
  walked. The vio Annecy dates and guests were set in the results-page bar
  (same controls as the home widget). The home widget's own behaviour after
  picking a place (calendar auto-opens) was observed on the first visit.
- **booking.com**: walked to results only; the browser was already signed in
  to an account, which may change defaults.
- **hotels.com Flow B price box**: the first attempt set a *minimum* of €175.
  It is logged but not counted, because I couldn't tell UI fault from tester
  fault.
- **One mis-tap** (2 Dec for 1 Dec) is logged but not counted.
- **mindtrip**: landing page only.
- **The localhost dev error toast** was not opened or investigated.

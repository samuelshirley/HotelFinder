# Settling more messages with Jev

Written 2026-11-11. The goal (Sam): "more questions regarding answers that we
are already expecting. Like if they say something in the chat about a listing
that is already listed on the page, it'd be nice if that was one of the Jev
options so that we never even call Haiku."

## Read this first: what is and is not known

- **Jev has never been called for this project.** Every label, every
  instruction sentence and both thresholds below are unverified wording. The
  code paths are proven with a fake Jev (`jevSays(...)`); whether the real
  model picks `ask_hotels` over `question` for "can I cancel the YOTEL?" is
  what `scripts/jev-live.sh` exists to find out. It now asks 36 messages
  (12 original, 24 added here).
- **There is no traffic.** No real user has typed a message, so every "share
  of deferrals removed" below is a guess, marked as one. Section 7 is how to
  turn them into numbers.
- **The saving is latency and correctness more than dollars.** A Jev call is
  about $0.00002 (500 input tokens at $0.042 per million). An agent turn on
  Haiku 5.5 ($0.10 / $0.50 per million) is of the order of $0.0003 to $0.001
  by arithmetic on a guessed 2,000 to 4,000 input tokens and one or two calls;
  that has not been measured either (build step 11). What a settled answer
  buys for certain: no model call to wait for, and a reply in which every
  number came from a row, so the number guard in `agent/guards.ts` has nothing
  to catch.

What the TypeSafe docs say that this design leans on (docs.typesafe.ai, read
2026-11-11; pages: api/system-one, concepts/state, primitives/choice,
confidence, patterns/companion-noul, patterns/noul-screen,
patterns/probability-routing, concepts/how-to-build-with-system-one,
cookbooks/function_calling, cookbooks/pre_parsed_value_extraction; the
self-consistency and date-extraction cookbooks were not read):

- All questions in one request are evaluated in parallel and in isolation
  against the same state, so adding questions "barely changes response time".
  Whether the state's tokens are billed once or once per question is not
  stated: read `usage.input_tokens` on the first live run.
- A choice takes 1 to 255 labels; a score 1 to 10 ordered levels; a noul may
  carry `criteria: { true, false }`. `instructions` and each criterion may be
  an object as well as a string (`not_for`, `examples` are free field names).
- A choice **always returns one of its labels**, often with high probability,
  even when none applies. The docs' own example scores an unrelated message
  0.96 for a wrong label. Their fix is a companion noul asked in the same
  request, read first. A `none` label "competes for probability" and is the
  weaker tool. This is the main risk in the catalogue as built (section 5).
- For a choice, route on the probability of the label acted on, not on
  `confidence` (a transform of the top probability that ignores the
  runner-up). That is what `readChoice` already does, plus the margin.
- Suggested noul bands are yes above 0.7, no below 0.3, the middle its own
  outcome. The router uses 0.8 / 0.2, stricter.
- Thresholds should rise with the risk of the action taken.
- "Ask the most explicit, narrow, specific, atomic questions you can"; keep
  database values in their own state fields; send only the context the
  questions need.

---

## 1. Questions about a hotel on screen (BUILT)

**Messages.** "how much is the second one?", "can I cancel the YOTEL?", "is
breakfast included at the carris?", "what is the third one rated?", "how many
stars does the palacio have?", "what room is the first one?", "how far is the
second one?", "does the second one have parking?", "does the yotel take
dogs?", "do any of them have a pool?", "which ones include breakfast?".

**Jev questions.** A new `intent` label and one new choice; the existing
`amenity` choice is reused to say which facility.

| Question | Labels |
|---|---|
| `intent` | + `ask_hotels`: "Asks for a fact the listing holds about the listed hotels, one of them or all of them: the price … Asking is not requiring: 'does it have parking?' belongs here, 'it needs parking' does not." |
| `fact` (choice) | `price`, `cancellation`, `breakfast`, `rating`, `stars`, `room`, `distance`, `facility`, `none` |
| `amenity` (existing) | the 14 must-haves + `none`; read only when `fact = facility` |

`price` is one label for total, per-night and pay-at-hotel on purpose: three
labels that Jev would have to tell apart, against one reply that states all
three. `intent.open` and `intent.question` were reworded to stay apart from
the new label (`question` is now "any other question: an explanation, an
opinion or knowledge the listing does not hold").

**Values code extracts.** Which hotel: `extractTarget` (ordinal, "#3",
"option 2", "the last one", a word unique to one name). Nothing else.

**Where the answer comes from.** The rows `searchTurn` already loads
(`listShortlist`), mapped by `hotelFacts` in `server/turn.ts`:

| Fact | Column |
|---|---|
| price | `offers.total_minor`, `pay_at_property_minor`; per night = ceil(total / nights), as the card and the price cap compute it |
| cancellation | `offers.refundable_tag`, `cancellation.freeCancellationUntil` |
| breakfast | `offers.board_name`, by `includesBreakfast`, the rule the must-have filter uses |
| rating | `properties.rating`, `review_count` |
| stars | `properties.stars` |
| room | `offers.room_name` |
| distance | `shortlist_entries.reason.distance_km` (the finder's number) |
| facility | `properties.content.amenities` (the supplier's facility ids mapped to the amenity enum) |

**Templates** (`answerLine` in `lib/replies.ts`, typed values from
`lib/answers.ts`):

- `YOTEL Porto: €127.93 for 2 nights, €63.97 a night, plus €19.36 paid at the hotel.`
- `Mercure Porto Centro Santa Catarina: free cancellation until 10 Dec, 09:59 UTC.` / `…: non-refundable at this price.` / `…: refundable, but the listing does not give the deadline.`
- `…: breakfast is not included; the rate is Room Only.` / `…: breakfast is included (Half Board).`
- `…: rated 9 from 2,856 reviews.` · `…: 4 stars.` · `…: the price is for Premium Queen.` · `…: 300 m from the middle of the results.`
- `YOTEL Porto lists parking.` / `… does not list parking.` "Lists", not
  "has": it is the supplier's facility list.
- No hotel named and the fact is yes/no (facility, breakfast, cancellation):
  `Listing parking: A and B. Not listing it: C, D and E. The listing does not say for F.`
- A value the row does not hold: `The listing for YOTEL Porto does not say whether it has parking.`
  One such line per fact. No list of facilities (`content.amenities` absent)
  is unknown, never "no".

**When it defers.** `fact` or `superlative` not settled (a settled `none`
counts as settled); `fact = facility` with an unsettled or `none` amenity; no
hotel named and the fact is a value ("how much is it?"); `fact = none` ("is
the second one quiet?"); `multi_intent` above 0.3; nothing on screen.

**Risk if Jev is wrong.** R0: nothing is written, nothing is fetched. The
failure is answering a different question than the one asked. It is bounded
three ways: every reply leads with the hotel's name and states the fact, so a
mismatch is visible; the value is always the row's, so a wrong answer is never
a wrong price; and the user's next message goes through the same pipeline.
The dangerous direction is the reverse one that already existed: "does it
have parking?" read as `must_have` adds a filter. Giving that message its own
label should reduce it; item 5 gates it.

**Share of deferrals removed.** Guess: a quarter to a half of deferrals once
a shortlist is on screen. Reasoning, not data: before this change every
question deferred (`question` → `intent_for_agent`), and after results appear
most of what a person types is either a tweak (already settled) or a question
about what they are looking at.

## 2. Comparisons and superlatives across the hotels on screen (BUILT)

**Messages.** "which is the cheapest?", "which is closest?", "which has the
best reviews?", "which has the most stars?", "how much is the cheapest?", and
the composed form "is breakfast included at the cheapest?", "does the closest
have parking?".

**Jev question.** `superlative` (choice): `cheapest`, `priciest`, `closest`,
`furthest`, `best_rated`, `most_reviews`, `most_stars`, `none`.

**Code.** `rankHotels` finds the extreme over the rows on screen. Two
readings compose (`RANKED_ON` in `route.ts`):

- superlative settled, fact `none` or the fact the ranking is about
  (cheapest ↔ price) → the ranking is the answer:
  `Cheapest of the 5 listed: YOTEL Porto, €127.93 for 2 nights.`
- superlative settled, a different fact → the fact is read from the winner:
  "is breakfast included at the cheapest?" → `YOTEL Porto: breakfast is not included; the rate is Room Only.`

A tie names every hotel (`Best rated of the 3 listed, tied: A and B, rated 8.7.`).
A hotel with no value for the metric is left out and counted
(`1 has no guest rating listed.`), never ranked as zero. A tie for "the
cheapest" in the composed form has no single hotel to read from, so the turn
goes to the agent (`deferred: answer_unavailable`). A hotel named **and** a
ranking with a different fact is two candidates: deferred.

**Risk.** R0, as above. Note the scope stated in every line: "of the 5
listed". The finder holds about 20 priced hotels; the cheapest of all of them
is a `set_priority` change, not this.

**Share.** Guess: a tenth to a fifth of the questions in item 1's population.

## 3. Questions about the search itself (BUILT)

**Messages.** "what dates did I pick?", "how many are we?", "where am I
searching?", "what is my budget?", "what did I say it needs?", "what am I
searching for?".

**Jev questions.** `intent.ask_search`, and `search_field` (choice): `dates`,
`guests`, `destination`, `budget`, `must_haves`, `priority`, `everything`,
`none`.

**Data.** The stay and session rows (`toSearchState`). **Templates:**
`11–13 Dec, 2 nights.` · `2 adults.` · `Searching Porto, Portugal.` ·
`Capped at €70 a night.` / `No price cap is set.` · `Must have parking and a pool.` /
`Nothing is required of the hotel yet.` · the order line, or all of them.

**Design choice.** An unsettled `search_field` does not defer: it answers
with the whole search, which contains the right answer whatever the field
was. Only a settled `none` defers.

**Risk.** R0. **Share.** Guess: small, a few percent of deferrals.

## 4. Not built, ranked

### 4.1 Run it live, then fix the wording (do this before anything else)

`scripts/jev-live.sh`. For each failing case the printed readings say which
question was unsure. Expected first findings, as guesses: `ask_hotels` versus
`must_have` on "does it have …"; `ask_hotels` versus `open` on "tell me about
the price of …"; `superlative` giving `cheapest` to "something cheaper"
(which is a `priority` message, so harmless unless `intent` is also wrong).

### 4.2 Let Jev pick the hotel when the pattern cannot

**Messages.** "the yotle", "the one by the river", "the mercure near the
station", "that 4-star one". Today these are `slot_missing` and defer.

**Questions.** `target` (choice) whose criteria are built per request from
the hotels on screen, key `h1`…`hN`, description the name (the pre-parsed
value pattern: code supplies the candidates, Jev picks, code copies), plus a
companion noul `names_listed_hotel`: "The message refers to exactly one of
the hotels in `hotels_on_screen`." Read `target` only when the noul is ≥ 0.8
and the pattern found nothing; if the pattern found a hotel and Jev settles
on a different one, defer.

**Data, template, risk.** As items 1 and 2. A wrong hotel on `exclude` is one
undoable re-rank; on `book` it opens a sheet the user reads. **Share.**
Guess: this is where most of the remaining `slot_missing` goes.

### 4.3 "It" and "that one"

**Messages.** After opening a hotel: "does it have parking?", "can I cancel
it?", "book it". Today: `slot_missing`.

**Code, no new question.** The hotel opened in the previous turn is in that
turn's `result_meta.ui.open`. Use it as the target when the message has a
singular pronoun and no other hotel is named, and only if that hotel is still
on screen. Optionally a noul veto, `refers_back`: "The message cannot be
understood without the previous message." Yes → the pronoun rule applies; in
the middle → defer. **Risk.** Answering about the previously opened hotel
when the user meant another; the reply names the hotel. Never used for
`book` without the hotel named in the reply and the payment form's own
confirmation.

### 4.4 Relative date and guest changes code can compute

| Message | Jev | Code |
|---|---|---|
| "a day earlier", "push it back a week", "move it two days later" | `dates_change` (choice): `longer`, `shorter`, `later`, `earlier`, `set_nights`, `none` | the count and unit by pattern; both dates move for later/earlier |
| "make it 3 nights", "just one night" | `set_nights` | check-out = check-in + n |
| "check out Sunday instead", "arrive on the Friday" | `dates_change` + `which_end` (choice: `check_in`, `check_out`) | the weekday by pattern; the nearest such day to the current date of that end; defer if two are equally near |
| "one more adult", "my brother is coming too" | `guests_change` (choice): `set`, `add`, `remove`, `none`; `who` (choice): `adults`, `children`, `rooms` | the count by pattern; a child still needs an age or it defers |
| "add a room", "two rooms" | as above | |

Every one becomes `set_dates` or `set_guests` through `dispatchActions`,
which already rejects past dates, more rooms than adults and over 30 nights.
**Template.** The existing `actionLine`. **Risk.** R1: a visible line states
the new dates or party, and it is one message to change back. A refetch costs
one supplier call. **Share.** Guess: the largest remaining group of *changes*
that defer, because `dates_shift` today only knows "N more/fewer nights".

Absolute dates in prose ("12 to 15 March") can use the same shape: code
parses candidate dates, Jev picks which is check-in. The docs have a
date-extraction cookbook for it (not read). Until then they stay with the
agent.

### 4.5 Two hotels compared

"is the yotel cheaper than the carris?", "what's the difference between 1
and 2?". Code extracts two targets (today two targets is null); `fact` as
built; template `YOTEL Porto €127.93, Hotel Carris Porto Ribeira €166.91: YOTEL Porto is €38.98 less.`
With `fact = none`, all held facts side by side. R0.

### 4.6 More facts the rows already hold

`address` (`properties.address`) and "why is this one first?" (the ranking
reason, `reasonText`). One label each on `fact`. R0.

### 4.7 The count questions

"how many have a pool?", "how many are under 100?". The finder's
`rejected` / `eligible` counts answer some of these across all ~20 held
hotels, but only for the filters currently set. Answering for a filter that is
not set means running the ranker without applying it: a new read-only finder
entry point. Flagged, not designed.

### 4.8 Adjacent and capability lines (needs Sam's decision)

Architecture §6 lists `adjacent` ("what's the weather?") and `capability`
("can you book flights?") as fixed lines. They are not built, and they sit
against the rule that Jev never refuses a user: a fixed "I only search
hotels" is a refusal in everything but the strike. Today a T2 defers.

## 5. Score and noul as vetoes and gates

The catalogue as built uses choices with a `none` label. The docs say plainly
that this is the weaker pattern. In order of value:

1. **`asks_not_requires` (noul).** "The user is asking whether something is
   so, not telling the search to require it." With `criteria.true` /
   `criteria.false` examples. Gate both ways: `must_have` applies only below
   0.2; `ask_hotels` answers only above 0.8. This bounds the one wrong settle
   in this document that changes the search.
2. **`answerable_from_listing` (noul).** "The answer is one of: price,
   cancellation terms, meals, rating, stars, room, distance, or a listed
   facility." Companion to `fact`; read `fact` only above 0.8. Stops "is the
   second one quiet?" being forced into `facility`.
3. **`names_listed_hotel` (noul).** Item 4.2.
4. **One noul per intent instead of `multi_intent`.** The docs' variation for
   inputs that can match several labels. Two intents above 0.7 is a
   multi-intent message, and the pair says which two, so "under 100 and with
   a pool" could later be settled as two actions instead of deferred.
5. **Per-risk thresholds.** `settleMin` is one number (0.85). Probability
   routing says to set it by what the action costs: R0 answers could settle
   lower (try 0.75), R1 stay at 0.85, `book` higher (0.92). Do not lower
   anything until section 7 gives a wrong-settle rate for it.
6. **A score for context dependence.** Levels: 0 "complete on its own", 1
   "leans on what is on screen", 2 "only makes sense as a reply to the
   previous message". Level 2 above 0.5 probability → defer (or item 4.3).
   Score rather than noul because the middle level is the common, safe case.

## 6. State and question shaping

- **Keep the state small and named** (it is). Prices are deliberately not in
  it: no question needs them, and it keeps money out of a third party's logs.
  A test holds that.
- **Point at fields with backticked paths** in `instructions`
  ("`user_message`", "`hotels_on_screen`"), as the docs recommend. Not done
  yet; do it with the first live tuning pass so the effect is measured.
- **Structured criteria for the pairs that blur**: `ask_hotels` / `must_have`
  / `open` / `question`. Each as `{ covers, not_for, examples }` with the same
  field names. Today they are one-line strings, one with an inline example.
- **Add `on_screen_count` and `last_opened`** to the state when 4.2 / 4.3 are
  built.
- **Batching is already one request.** Nine questions now. Adding the nouls
  in section 5 should not change latency, by the docs' account.

## 7. Measuring it

**What is logged per turn now.** `usage_events` (`provider = 'jev'`) `meta`:
`tier`, `intent`, `fact`, `superlative`, `search_field` (each as
`{ choice, top, margin }`), `multi_intent`, `decision`
(`actions | ui | line | answer | defer`), `deferred` (the reason) and
`turn_id`. Labels and numbers only; a test asserts the message text is not
there. `agent_turns.result_meta` holds the same decision plus the plan and
`answered` (the answer kind, so `not_held` answers can be counted).

**Settle rate** (run against PGlite in `turn.test.ts`):

```sql
select meta->>'decision' as decision, meta->>'deferred' as deferred, count(*)
from usage_events where provider = 'jev' group by 1, 2 order by 3 desc;
```

Settle rate = rows where `decision <> 'defer'` over all rows. The `deferred`
column is the worklist: `slot_missing` is extraction (4.2, 4.3, 4.4),
`intent_unsettled` and `slot_ambiguous` are wording and thresholds,
`intent_for_agent` is the genuine remainder.

One gap: a turn that defers after routing (`answer_unavailable`, a tie) is
`answer` in the ledger and `defer` in `agent_turns.result_meta`. Join on
`turn_id` if that case matters.

**Wrong-settle rate. Not built.** Three ways, cheapest first:

1. **A labelled set.** Grow the 36 live cases to a few hundred, each with the
   expected decision, and report agreement per intent plus a
   probability-versus-correct table per question. That table is what picks
   `settleMin`. With no users, the messages come from the 20 personas.
2. **Shadow sampling in `on` mode** (promised in architecture §6): for a
   sampled fraction of settled turns, also run the agent, apply nothing, and
   log whether its queued actions equal the router's. It measures changes
   well and answers poorly, since the agent's answer is prose.
3. **Behavioural proxy.** Log whether the next user message within two
   minutes is `undo`, a repeat of the same intent on the same target, or
   opens with "no". Noisy, free, and the only signal that comes from the user.

Also log: `answered = 'not_held'` rate per fact (how often the listing is
silent: that is a supplier-data number, not a Jev number), and latency p50 /
p95 of the Jev call against the agent's.

## 8. What stays with the fallback model, and why

- **A new search or destination, and any place named in free text.** A place
  is a lookup at the supplier and a choice among results; Jev cannot extract a
  name.
- **Opinions and anything no row holds**: quiet, safe, nice, the
  neighbourhood, "which would you pick?". There is no fact to template.
  (The agent may not state them as fact either; it can say what the listing
  text says.)
- **Detail-sheet content** (description, check-in time, policies): needs a
  supplier call and free text. Could become a `fact` later if the detail
  fields prove structured.
- **Multi-intent messages**, until section 5.4.
- **Messages that only make sense as a reply** to the previous turn, until
  4.3.
- **Every refusal and strike** (T3). Jev may wave through; it never blocks.
- **Anything that moves money.** `book` only opens the hotel.

## Mutation log (2026-11-11)

40 mutations, 40 killed, none survived. Each was applied, the unit and turn
tests run, and the file restored.

Rows read as a guess: no facility list read as an empty list (in
`hotelAnswer`, in the across-all answer, and in `turn.ts`); a null refundable
tag read as non-refundable; a silent board name read as "not included"; a
silent refundable read as non-refundable; a missing metric ranked as zero;
missing rows not counted.
Routing: an unsure `fact` answered; an unsure `superlative` answered; an
unsure amenity answered; an unsure `search_field` acted on; a settled `none`
field answered; `fact = none` answered; any fact asked of all hotels; a
different fact at a ranked hotel turned into the ranking; the matching fact
not treated as the ranking; a named plus a ranked hotel not deferred; the
free-cancellation mapping dropped; an empty screen not deferred; a label
outside the catalogue acted on (fact, superlative).
Values: per-night rounded down; a deadline printed on a non-refundable rate;
an invalid deadline not caught; a tie answered with the first winner; a tie
borrowing one hotel's review count; lowest picked for highest; a hotel no
longer on screen answered with the first row; the surcharge-breakfast board
counted as included; "not listed" said as "listed"; pay-at-hotel dropped;
distance always "from the place you named"; a search answer from stale state.
Turn: an answer also handed to the agent; no answer not handed to the agent;
`decision` and `deferred` missing from the ledger. Jev module: `fact` read
against the wrong labels; `search_field` read from the wrong key.

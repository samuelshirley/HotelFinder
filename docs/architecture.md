# Architecture — chat-first hotel finder

2026-11-11. Written before any code. It restates the Feral Travels architecture
for hotels, records what Sam decided on 2026-11-11, and lists what is still
open. Tags: **[D]** Sam's decision, **[V]** verified against a vendor doc or the
Feral repo today, **[U]** unverified, to be proven in the sandbox before code
depends on it.

## 1. The product in one line

A chat that finds the right hotel for your dates, budget and must-haves, shows
the best few with real prices and the reason each was picked, and takes payment
without leaving the conversation.

Beyond that line (flag before building): flights, packages, loyalty, reviews we
write, price alerts, group bookings, saved cards, a second supplier, native app.

## 2. Decisions made (2026-11-11)

| # | Decision | Tag |
|---|---|---|
| 1 | Purpose is curiosity and a possible business; no deadline | D |
| 2 | One supplier for v1: LiteAPI (Nuitee). Adapter interface from day one | D |
| 3 | Booking happens in the chat: a payment form row that mounts the supplier's payment SDK (Stripe Elements). Our server never receives card data. Nuitee is merchant of record on this path | D, V |
| 4 | Anonymous users can search and see public prices. Six-digit email OTP, no passwords, unlocks member prices and is required to book | D |
| 5 | Thin margin. The number is a config value set after the step-9 cost measurement, not a constant | D |
| 6 | Member (below-public) prices are never shown to an anonymous session. LiteAPI treats a public price under the hotel's suggested selling price as a rate violation; closed user groups are the permitted route | D, V |
| 7 | Jev is the first responder on every message. It settles what it is confident about; everything else goes to Haiku | D |
| 8 | "Best" is asked once as a chip question: cheapest / closest / nicest / just a safe bed. Free text maps onto the same four values | D |
| 9 | Remembered preferences are restated as one plain sentence at the start of the next search and confirmed, never silently applied | D |
| 10 | Desktop web first. Chat on the left, results panel on the right | D |
| 11 | Same stack and visual language as Feral Travels (Nocturne tokens) | D |
| 12 | Saved cards are phase 2 | D |

## 3. Stack

Same as Feral Travels, versions as pinned there today **[V]**: Next.js 14 (App
Router) + React 18 + TypeScript, Neon Postgres via `postgres` + Drizzle, Zod,
NextAuth v5 (email OTP), Resend, Anthropic SDK with Haiku 5.5
(`claude-haiku-5-5`) in one model registry, Vitest + PGlite +
Playwright, Vercel. No mobile app, no RevenueCat, no IAP paywall.

New pieces: the LiteAPI adapter, the Jev router, the payment-form chat row.

## 4. The store: one state, typed actions, one dispatch path

Sam's framing is a Redux store, and it fits.

- **State** is the search session in Postgres: stays (destination, check-in,
  check-out, guests, rooms), hard constraints (price cap, currency), must-haves,
  the priority (decision 8), resolved POIs, the current shortlist, a staged
  action if one is pending.
- **Actions** are a closed, Zod-typed union: `set_priority`, `set_price_cap`,
  `toggle_must_have`, `set_dates`, `set_guests`, `set_near_poi`,
  `exclude_offer`, `more_options`, `open_offer`, `begin_booking`,
  `confirm_staged`, `drop_staged`, `undo`, `submit_idea`, `add_user_named_property`.
- **Reducers** are pure functions `(state, action) → state`, unit-tested.
- **Effects** run after a reducer changes search-relevant state: the stay
  finder re-runs and replaces the shortlist.
- **Two producers, one consumer.** The Jev router and the Haiku agent both emit
  actions and nothing else. Neither has a write path of its own; both go
  through the same validate → dispatch → finder → derived-facts pipeline. This
  is the staged-yes template from Feral applied to every message.

## 5. One chat turn

1. **Client send**: `POST /api/session/turn` with `{ sessionId, message,
   idempotencyKey }`. One Zod schema.
2. **Cheap gates**: kill switch, per-IP limits, per-session and per-user dollar
   caps, global breakers (503 `circuit_open`). Anonymous sessions have no
   entitlement to check, so they get the tightest caps.
3. **Durable turn record**: insert `queued` keyed on the idempotency key,
   persist the user bubble, promote to `running`. A partial unique index on
   `(session_id) WHERE status = 'running'` makes one-running-turn a database
   fact.
4. **Staged yes**: a plain yes to the previous turn's staged action applies it.
   No Jev, no model.
5. **Deterministic rules**: an obvious ALLOW (names something in this session)
   or DENY (shapes no real user types).
6. **Jev router** (section 6). If it settles, dispatch and reply from templates.
7. **Haiku agent** for everything Jev did not settle: the Feral loop unchanged
   in shape (context built from the DB, XML-sectioned prompt, prompt caching,
   lookup tools inline, action tools validated and queued, budgets, reply
   guards).
8. **Dispatch and derived truth**: fresh ownership check per action, reducers,
   finder, then the server computes every number the user sees.
9. **Persist and observe**: assistant row, turn row `done` with
   `result_meta` (router decision, toolTrace, turnTrace, guard counts).
10. **Streaming and reconcile**: SSE; the work completes if the client
    disconnects; `GET /api/session/[id]/turns` reconciles on reopen.

## 6. The Jev router

### What Jev is **[V]**

TypeSafe AI's hosted decision model. `POST https://api.typesafe.ai/v1/systemone`
with a `state` and a record of `questions`, `Authorization: Bearer` key, model
`jev-latest` (endpoint and shape from docs.typesafe.ai, 2026-11-11). It
answers choice, yes/no (noul) and score questions over labels we supply, with a
probability per label. It cannot extract a number, a date or a name. Listed
price is $0.042 per million input tokens, output free: a 500-token routing
call is about $0.00002. Feral reads only its own two numbers from the
response: the chosen label's probability (`top`) and top minus runner-up
(`margin`); the backend's own `confidence` field is not used there.

**[U]** not yet called with this project's key.

### What it does here

One request per message carrying several questions:

| Question | Type | Labels |
|---|---|---|
| `tier` | choice | T1 this search / T2 adjacent / T3 junk |
| `intent` | choice | the catalogue below, plus `none` |
| `multi_intent` | yes/no | veto: more than one request in the message |
| `target_offer` | choice | the shortlisted properties by name, plus `none` (only when a shortlist exists) |
| `amenity` | choice | the amenity enum the supplier can actually filter on, plus `none` |

Then code, not a model:

1. **Settle test** per answer: `top ≥ JEV_SETTLE_MIN` (0.85 to start) and
   `margin ≥ 0.2`, the choice is the most probable label, every label is one we
   offered. Any failure → Haiku.
2. **Slot extraction in code**: numbers and currency by pattern, dates by the
   deterministic half of the date parser, ordinals ("the second one") by
   pattern, with `target_offer` as the fallback.
3. **Validation against session state** with the same validators the agent's
   action tools use.
4. **Risk class**: R0 no write (fixed line); R1 reversible search change
   (apply); R2 money or irreversible (`begin_booking`) → always staged or
   routed into the rate re-check and payment form, where the user confirms.

If any step fails, the message goes to Haiku with nothing applied.

### Intent catalogue (v1 draft)

| Intent | Action | Slots, source | Risk |
|---|---|---|---|
| `priority` ("cheapest", "something nicer") | `set_priority` | enum, Jev choice | R1 |
| `price_cap` ("under 120 a night") | `set_price_cap` | number + currency, code | R1 |
| `must_have` ("needs parking", "no need for breakfast") | `toggle_must_have` | amenity, Jev choice; add/remove, Jev yes/no | R1 |
| `guests` ("there are four of us") | `set_guests` | numbers, code | R1 |
| `dates_shift` ("one night longer") | `set_dates` | relative shift, code | R1 |
| `closer_generic` ("closer to the centre / beach") | `set_near_poi` | category enum, Jev choice | R1 |
| `exclude` ("not that one") | `exclude_offer` | ordinal or `target_offer` | R1 |
| `more` ("show me others") | `more_options` | none | R1 |
| `open` ("tell me about the second one") | `open_offer` | ordinal or `target_offer` | R0 |
| `book` ("book the first one") | `begin_booking` | ordinal or `target_offer` | R2 |
| `accept` / `decline` | staged action | from the stage, never re-extracted | as staged |
| `undo` | `undo` | none | R1 |
| `greeting_or_thanks` | none | none | R0 |
| `adjacent` (weather, visas, safety) | none, one honest line | none | R0 |
| `capability` ("can you book flights") | `submit_idea` + fixed line | none | R0 |

**Stays with Haiku**: a new search or a destination change, anything naming a
place in free text ("near the Sagrada Família"), absolute dates in prose,
questions about a property ("is it quiet?"), multi-intent messages, anything
the veto flags, everything unsettled.

### Asymmetries that do not move

- **Jev never refuses a user.** A T3 (strike) is Haiku's call only, as in Feral
  **[V]**. Jev may say "go ahead" or "I know what this is", never "blocked".
- **A wrong R1 is one visible, undoable re-rank.** A wrong R2 cannot charge
  anyone: booking always passes through the rate re-check and the payment form.
- **Every error path defers to Haiku**: not configured, timeout (800 ms), HTTP
  error, bad JSON, schema mismatch.

### Modes and measurement

Same three modes as Feral, as a database row with a per-account override:
`off`, `compare`, `on`. Default for this build is `on` **[D]**. Every Jev call
writes a `usage_events` row (`provider: 'jev'`) with top, margin, latency,
settled or the deferral reason. In `on` mode a sampled fraction of settled
messages is also sent to Haiku and only logged, so the wrong-settle rate is a
measured number from day one rather than a belief.

### Bounded module

`src/server/jev/index.ts` is the only public surface. Only the turn route's
router and the admin routes may import it (guard test). The endpoint defaults
to TypeSafe's public API, so `JEV_API_KEY` is the only required setting.
`JEV_BASE_URL` is an optional override (a compatible local server), server-only,
never `NEXT_PUBLIC_*`, local hosts only on a laptop: wherever it points
receives users' messages, so it is a privacy boundary
**[V, ported from Feral I21/I22]**.

## 7. Where Haiku is still required

- **The intent scan** on a new search: one forced-tool call that transcribes
  destination, dates, guests, budget and must-haves from messy text. Jev cannot
  extract values. The server re-validates every field; null beats a guess.
- **Completeness is a null-check**, not a classifier: missing required fields
  become form-in-chat questions (`kind = 'form_question'`, chips).
- **The agent loop** for whatever the router defers.

Expected shape of a simple session: one Haiku extraction, N router-settled
refinements, zero agent loops. Whether that holds is what step 9 measures.

## 8. The stay finder (deterministic, server-side)

`search → normalize → hard-constraint filter → rank → reasons`. Pure and
unit-tested on captured sandbox fixtures.

- The agent and the router call it. Neither finds hotels from its own knowledge.
- Shortlist rows are created only by the finder. The agent's
  `add_user_named_property` is schema-locked to `user_named`.
- Hard constraints (dates, guests, rooms, price cap, must-haves) filter.
  The priority (decision 8) orders what survives.
- Every shortlisted offer carries a machine-readable reason, e.g.
  `{kind:'cheapest_meeting_all_musts'}`, `{kind:'closest_to_poi', walk_min}`.
  The client words it. The model may quote it, never invent one.
- Distances come from geometry on resolved coordinates. `resolve_place` is the
  only source of coordinates.
- Zero candidates from the supplier is a retryable failure, never a cached
  "none found".

## 9. Prices

- Every price, tax, fee, currency, room type, board basis and cancellation term
  shown comes from an `offers` row: `supplier`, `supplier_offer_id`,
  `fetched_at`, `expires_at`, `audience`, `margin_pct`.
- **Audience is structural.** An offer is fetched as `public` or `member`. The
  server derives the audience from the session's auth state; the client cannot
  ask for it. A member offer is never serialised to an anonymous session (guard
  test plus a repo-level filter).
- Primary number is the total for the stay including taxes and fees; per-night
  is secondary; anything paid at the property is labelled from supplier data.
- Model prose never contains a currency amount, a fee, a cancellation term or
  an availability claim. Nudge once, then strip (runtime guard + guard test).
- Static content is cached for days; rates for minutes.
- **Re-check before money**: `begin_booking` calls the supplier's prebook. A
  changed price is shown with both numbers and needs a fresh yes.

## 10. Booking and the payment row

1. `begin_booking` (signed-in only; an anonymous user gets the OTP form row
   first) → prebook with `usePaymentSdk: true` → `prebookId`, `transactionId`,
   client secret **[V]**.
2. A chat row of `kind = 'payment_form'` mounts Stripe Elements with that
   secret. Card data goes from the browser to Stripe.
3. On payment success the client posts `{ prebookId, transactionId }`; the
   server calls book and stores the booking.
4. The row then renders as a receipt: total, booking reference, status. It is
   never part of the model's context.

**[U]** whether the SDK returns card brand and last four for the receipt, and
whether it supports saved payment methods. Until proven, the receipt shows
neither and saved cards stay in phase 2.

## 11. Accounts, preferences, spend defence

- NextAuth v5 email OTP. 401 = signed out, 503 = dependency down, 503
  `circuit_open` = breaker. No 402 in v1: there is no paywall.
- An anonymous session is a signed cookie id; it is adopted by the account on
  sign-in so the search is not lost.
- `user_preferences` stores only confirmed values (priority, usual party,
  must-haves). The next search opens with one sentence and chips; a yes costs
  no model call.
- Every paid or metered call writes `usage_events`: Anthropic, Jev, LiteAPI
  (`liteapi:search`, `:prebook`, `:book`), Google. Only AI spend gates users.
- A bounded `payments/` module still exists with one public question
  (`canBook(userId)`), so a later revenue or entitlement change has one seam.

## 12. Supplier adapter

`searchAvailability`, `getStaticContent`, `recheckRate`, `book`, `getBooking`,
`cancel`, over normalized `Property`, `Offer`, `CancellationPolicy`, `Money`.
LiteAPI sandbox is the only implementation. Tests run on **recorded** sandbox
responses; supplier payloads are never hand-written. Supplier ids are opaque:
forwarded untouched, never authored or edited by a model.

### Probed in the sandbox, 2026-11-11 **[V]**

Five Porto hotels, 2 adults, 11–13 Dec 2026, EUR, `POST /v3.0/hotels/rates`.

- The suggested selling price is `roomTypes[].suggestedSellingPrice` and
  `rates[].retailRate.suggestedSellingPrice`, with `source: "providerDirect"`.
- Omitting `margin` returned the same prices as `margin: 0` on this account.
- **The gap between net and suggested price is per hotel, not a constant.**
  Two samples: net 256.18 vs suggested 281.29 (9.8%), and net 238.52 vs
  suggested 239.95 (0.6%). At a 1% margin the first sells 8.0% under the
  public price and the second 0.4% over it. `margin: 15` put both above the
  hotel's own suggested price.
- `retailRate.taxesAndFees[]` carries `included: true|false` (the sample had
  City Tax €12 not included, VAT included), which is what the "paid at the
  property" label needs.
- `cancellationPolicies.refundableTag` exists (`NRFN` in the sample).
- Five hotels returned 2.7 MB in 2.2–3.7 s. The finder has to bound and trim
  what it requests; an unbounded fan-out is the cost and latency risk.

Sandbox data may be synthetic, so the gap figures are a shape, not a market
measurement.

Second probe, same day **[V]**:

- **Must-haves the supplier can answer structurally:** hotel details carry
  `petsAllowed` (bool), `parking` (enum), `childAllowed`, coordinates, rating,
  review count, and a facility list from an 820-entry catalogue that includes
  "RV, bus, truck parking", "Free self parking" and "Soundproof rooms".
- **Must-haves it cannot:** nothing structured for "quiet", "safe" or
  "walkable". `hotelImportantInformation` is free text (the sample said the
  hotel is on a pedestrian street, which matters for a pickup).
- `/data/reviews?getSentiment=true` returns category ratings with pros and
  cons. These are supplier-generated summaries of guest reviews: quotable as
  "guest reviews say", never as our own claim.
- `/data/places?textQuery=` returns place ids, and `/hotels/rates` accepts
  `placeId`, `cityName` + `countryCode`, or `aiSearch`. Whether a place id
  comes with coordinates for our own distance maths is **[U]**.
- **A bounded search is cheap enough:** `limit: 20, maxRatesPerHotel: 1`
  returned 69 KB in 3.6–4.0 s, with a `hotels[]` array (name, photo, address,
  coordinates, rating, stars) sufficient to build cards from one call.
- `guestNationality` is required (400 without it). Children are priced by age.
- `min-rates` needs hotel ids; it is not a city search.

From LiteAPI's docs, not yet exercised **[U]**: prebook and book each take
5–10 s; the payment SDK redirects to a `returnUrl` after payment; the sandbox
allows 5 requests per second; a production key needs a credit card on the
account; LiteAPI ships its own embeddable chat booking widget.

Step 3 findings (book is not idempotent; no-availability arrives on HTTP
200; fee descriptions are free text): `docs/supplier.md`.

**Consequence for the finder:** fetch and rank are separate. A refinement that
does not change destination, dates or guests re-ranks the cached result set
and makes no supplier call.

## 13. UI

Desktop, two panes. Left: the chat, composer always reachable, form rows
(chips, OTP, payment) inline. Right: the shortlist (three to five cards: photo,
name, rating from supplier data, total and per-night, cancellation line, the
reason, one primary action), a detail view for one property, and a map toggle
showing the shortlist and the user's POIs. No filter sidebar, no sort dropdown,
no infinite list: those are messages.

Nocturne tokens from Feral (`--tp-*`: ground `#161826`, surface `#232532`,
accent `#9184d9`, Inter, Phosphor icons) **[V]**.

## 14. Invariants (each gets a structural guard or a mutation-checked test)

1. Every API route accepts exactly one Zod schema.
2. All DB access goes through `src/server/repos/`.
3. The model and Jev emit typed actions only; one dispatch path.
4. No price, fee, tax, cancellation term or availability claim in model prose.
5. Shortlist rows come only from the finder; `add_user_named_property` is
   locked to `user_named`.
6. Supplier ids are opaque.
7. A member offer never reaches an anonymous session.
8. A rate is re-checked before any payment form is shown; a changed rate is
   shown, never absorbed.
9. One running turn per session (partial unique index); turns are idempotent
   and finish without the client.
10. A staged yes calls neither Jev nor the model.
11. Jev can never produce a refusal or a strike, and never an R2 write without
    the user's confirmation.
12. Only the router and admin routes import `src/server/jev/`.
13. Every paid or metered call writes `usage_events`.
14. 401 / 503 / 503 `circuit_open` semantics as above.
15. No silent error swallowing; every error code has client copy.
16. Every timestamp is `withTimezone: true`; stay dates are `date` columns.
17. Model ids live in one registry; a test fails if the agent's model changes.
18. Test-only endpoints carry the three guards; no auth bypass in `src/`.
19. Card data never reaches our server or our database.

## 15. Open

| # | Question | Owner |
|---|---|---|
| 1 | Margin for member and public prices, after the step-9 numbers | Sam |
| 2 | LiteAPI's contract terms for a closed user group: does an OTP email account qualify? | Sam, at signup |
| 3 | TypeSafe's data-handling terms for user messages, for the privacy page | Sam |
| 4 | Names: the product, the agent, the finder | Sam |
| 5 | New Neon project, Vercel project, Resend sender, Google Maps key (or reuse Feral's) | Sam |
| 6 | Are `docs/` in git here? (Feral keeps them local.) Currently in git | Sam |
| 7 | Jev settle threshold for intents: 0.85 is Feral's tier value, not measured for hotel intents | measured in step 9 |
| 8 | SDK receipt fields and saved cards (section 10) | sandbox |
| 9 | Is LiteAPI's price for the same room competitive with Booking.com and Vio? Needs a production key; 20 hotels, same dates | measured before step 5 |
| 10 | Where the first users come from at a margin that cannot pay for ads | Sam |
| 11 | What this does that LiteAPI's own chat widget does not | Sam |
| 12 | Who answers the guest when a hotel booking goes wrong; minimum servicing in v1 (confirmation, my bookings, cancel) | Sam + LiteAPI |
| 13 | Travel-agency registration in Catalonia for mediating accommodation; who is the seller of record in the terms | Sam + gestor |
| 14 | Proposed invariant 20: margin and commission never influence rank; a "how we rank" page states the parameters | Sam |
| 15 | English only for v1 (code-side slot extraction is per language) | Sam |
| 16 | Retention for anonymous sessions and chat text | Sam |
| 17 | Payment without leaving the chat: iframe around the SDK redirect, or LiteAPI's Stripe publishable keys | sandbox + LiteAPI support |
| 18 | **Decided 2026-11-11:** "best" is relative, so ranking is judged by 20 simulated personas with different backgrounds and aims, not one golden list. Users are simulated the same way before any release | D |

Working defaults, taken so the build can proceed and not yet confirmed by Sam:
margin never influences rank (14); confirmation, bookings view and cancel are
in v1 (12); English only (15); anonymous sessions purged after 30 days (16);
a global anonymous AI-spend breaker at $5 a day. Distribution (10), the
travel-agency question (13) and guest support (12) are parked: this is a test
build.

## 16. Build order

1. This note and `CLAUDE.md`. **Stop for Sam.**
2. Schema and repos, PGlite round-trip tests.
3. LiteAPI adapter on recorded sandbox fixtures.
4. Stay finder.
5. Store: actions, reducers, dispatch.
6. Jev module and router, with the compare sampler.
7. Turn route: gates, turn record, SSE, Haiku loop, staging, reconcile.
8. Form-in-chat onboarding and the intent scan.
9. UI: chat, results panel, detail, map, OTP row, payment row.
10. Guard tests (mutation-checked) and Playwright through the real OTP flow.
11. Cost measurement: three scripted conversations, each run with Jev `on` and
    `off`. Model calls, Anthropic cost, Jev calls and settle rate, supplier
    calls, latency per turn.

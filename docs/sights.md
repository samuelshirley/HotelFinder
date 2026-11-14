# Sights: "I want to tour some museums"

Built 2026-11-13. Sam's request, from a real session: he typed "actually I
want to go 4 nights and tour some musems" and Penny answered only the nights
("11–15 Dec, 4 nights. 25 of 30 hotels fit."). He wanted the museums: which
are the popular ones, a hotel well placed for them, and a plan for each day
with Google Maps links.

**This is beyond the one-line scope in `architecture.md` §1** (a hotel finder,
not a trip planner). Sam asked for it knowingly; it is held to the smallest
form that helps pick a hotel: a kind of sight changes where "close" is, and
the plan is geometry on the same rows. No opening hours, tickets, itineraries
with times, restaurants or anything a model writes.

## What happens

1. **The message.** Jev has a `sights` intent and a `sight_kind` question
   (museums, galleries, none). A message that is only about sights settles in
   the router; one that also asks for something else ("4 nights and…") is the
   agent's, which has `plan_sights {kind}` and `clear_sights`. Both produce the
   same typed action, `set_sights {kind}`. **Only the kind**: no producer can
   name a sight or give a coordinate (the schema refuses both).
2. **The lookup, in dispatch** (the one place a named place's point is also
   resolved): Google Places (New) **Nearby Search** for the kind's primary
   types within 8 km of the destination's own point, ranked by popularity.
   `server/sights/` is a bounded module; `google.ts` is the only file that
   calls Google and `index.ts` meters every call.
3. **The pick** (`lib/sights.ts pickSights`, pure): rated 4.0 or more from at
   least 50 reviews, then **most reviewed first**, at most 8. The review count
   is the measure of "well known"; the rating is only a floor.
4. **The stay** keeps the list (`stays.sights`). A stay uses as many as its
   nights have time for: two a day, at least three (`sightCount`). "Close" is
   measured from the **middle of those** (median latitude and longitude),
   stored in the same columns a named place uses (`near_place_id` is
   `sights:<kind>`), so the radius search, the ranking, the card reasons, the
   map anchor and ring and the "Near … ✕" chip all work unchanged. Closeness
   joins what "best" means, next to what was picked before.
5. **The line**: "The most popular museums in Porto, by Google reviews: A, B,
   C and D, and 4 more. A plan for each day is above the hotels." A template
   over Google's names; says where the ranking came from.
6. **The plan** (`walkingPlan`, pure; `components/SightsPlan.tsx`): above the
   hotel list, starting from the top pick, with a picker for any other listed
   hotel. One day per night, fewer when there are not two sights each. Sights
   in the same direction from the hotel share a day (sorted by bearing, the
   circle cut at its widest gap); within a day the nearest comes next; the
   shortest day is day one. Each sight links to itself on Google Maps by place
   id; each day links to walking directions from the hotel's coordinates
   through its stops (Maps URLs, no key). The sights are marked on the map.

Changing the nights does not ask Google again: the same list has more or fewer
in play, and the middle moves with it (`reduce.ts`, `set_dates`). Naming
another place to be close to, clearing it, or a new destination drops the
sights. "Remove the plan" is the near chip's own clear.

## Why these choices

- **Nearby Search with primary types, not Text Search or `includedTypes`.**
  Tried live on Porto (2026-11-13). `includedTypes: ['museum']` returned
  churches and port cellars (Torre dos Clérigos, Caves Cálem: places that
  merely list `museum` among their types). `includedPrimaryTypes` returned
  twenty museums. Text Search needs a query in some language and only biases
  by location; Nearby takes a hard circle and ranks by popularity.
- **Only museums and galleries.** A "landmarks" kind was tried
  (`historical_landmark`, `tourist_attraction`, `monument`): Porto came back
  with river beaches and a statue, without the Clérigos tower (a `church`).
  Not a list worth ranking hotels by, so it is not offered.
- **The middle of the sights, not the nearest or the average distance.** One
  point reuses the whole "close to a place" path, and a median is not dragged
  across town by one far sight: Porto's eight include the stadium museum 3 km
  east and Serralves 4 km west, and the middle still sits in the centre
  (under 3 km from the town's point; tested).
- **Distances are straight lines, and say so.** Nothing claims a walking
  time; the route link hands the real walk to Google Maps. A stop far from
  the hotel still gets a walking link (Google lets the user switch mode).
- **The model writes nothing.** The line, the plan, the names, ratings and
  review counts are Google's rows through templates and geometry. The agent's
  prompt forbids naming a museum from its own knowledge; the live case checks
  its reply names none.
- **A failed lookup changes nothing at all.** Found by the first run of the
  failure tests: closeness had been added by the producer, so a refused
  Google call still re-ranked the hotels while the line said "nothing was
  changed". Closeness is now added in dispatch, after the places are in hand.

## The key

One Google key, `GOOGLE_MAPS_API_KEY`: **server-only**, never `NEXT_PUBLIC_`
in this repo, sent in a header. Since 2026-11-14 it is this project's own key,
set by Sam in `.env`; `scripts/google-key.sh --vercel` sends it to Vercel
(production and preview, sensitive) without printing it. The script's default
still borrows Feral Travels' `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` into `.env` and
Vercel. With no key the lookup answers
"not configured": the line says the lookup did not answer and nothing changes.

Cost: Nearby Search with rating and review count is the **Enterprise SKU,
$35.00 per 1,000 after 1,000 free a month** (Google's pricing page, read
2026-11-13). One call per sights request: 3.5 cents at list price, written to
the ledger as `google:places` for every answered call and 0 for a refused or
lost one. It gates nobody (only AI spend does).

Google's terms let a place id be kept indefinitely; names, coordinates and
ratings are meant to be cached for no more than 30 days. They live on the stay
row, stamped `fetchedAt` when Google answers. **After 30 days they are
deleted** (Sam, 2026-11-14): `purgeExpiredSights` (repos/sessions.ts) clears
the places and the "close to the museums" point between them, and replaces
every assistant line and agent reply in that search that named one with "This
list of museums was more than 30 days old, so it was removed. Ask again for
today's." The kind, the search and its ranking stay; nothing is fetched again
until the user asks. It runs from `GET /api/sights/purge` (Vercel Cron, daily
at 04:00 UTC, `vercel.json`; needs `CRON_SECRET`, 404 without it) and at the
start of every new search, so it happens even when the cron does not. A row
with no `fetchedAt` counts as expired. Tests: `src/test/pg/sights.test.ts`
("the 30-day purge", 4 mutations caught), `e2e/api/sights.spec.ts`.

## Measured

- **Jev, live, 2026-11-13: 87 of 87** (the 78 earlier cases unchanged). The
  four sights messages that settle read `sights` at 0.95–1.0 and the kind at
  1.0, in English and Spanish. "somewhere close to the museums" reads
  `sights` 0.62–0.69 with `names_place` 0.85–0.87 (it takes "the museums" for
  a place), so it goes to the agent, which has both tools. One museum named
  by name reads as `priority` with `names_place` 0.97–0.98 and takes the
  existing named-place path. The new intent and question cost about 230 input
  tokens a message (2,738 against 2,510).
- **The agent, live (Haiku 5.5), 2026-11-13:** Sam's own message, typo
  included, gives `set_dates` to 4 nights and `set_sights museums` and names
  no museum; "somewhere close to the museums" gives `set_sights`; a Spanish
  message with galleries and parking gives both. (Four older intent-scan
  cases in that suite fail on `rooms: 1` vs `null`: they predate room splits
  and are not touched here.)
- **In a real browser** on the sandbox: Sam's message re-ranked Porto around
  the museums and drew four days of two; `e2e/ui/sights.spec.ts` (desktop, the
  hotel picker and remove, phone at 390×780) passes with `E2E_AI=1`.

## Tests

`lib/sights.test.ts` (parsing, the pick against an oracle written from
Google's raw rows, the plan's properties, the links), `server/sights/`
(the request equals the recorded one; errors are values; the meter; the
recorded-fixture guard), `store/reduce.test.ts`, `router/route.test.ts`,
`agent/agent.test.ts`, `test/pg/sights.test.ts` (the whole turn on PGlite with
the recorded supplier and the recorded Google responses, both producers,
Spanish, every failure). Fixtures: `scripts/capture-google-fixtures.mjs`
records five real responses; never hand-written.

The e2e spec is `@ai`: sights can only be asked for in the chat, which needs
the real Jev, and the places need the real Google. **CI does not run `@ai`
and has no Google key**, so in CI this feature is covered by the unit and
PGlite tests only.

Mutation checks: see the list at the end of this file.

## Not built

A chip or button to ask for sights without typing. Kinds beyond museums and
galleries. Walking times or routes of our own (straight lines only). Opening
hours. A plan in the hotel's detail view. The plan in Spanish is translated;
Google's names follow the language asked for.

## Mutation checks

2026-11-13/14: 41 on the code, all caught after one test was added for the
survivor (the rating floor: no recording holds a famous, poorly rated museum,
so a recorded place is given a 3.9). They cover: the pick (rating instead of
reviews, either floor, the radius, closed, other kinds, unrated), how many a
stay uses, the plan (nearest-next, day order, more days than nights,
direction), the links (driving, no place ids), the store (a named place, new
dates, a new destination, the fingerprint, places from a producer), dispatch
(closeness added on a failed lookup, never, or twice; too few still set), the
router (a named place read as every museum; a kind looked up as a place; an
unsure kind; a weak intent alone), the agent tool taking extra fields, the
meter (a refused call charged; a call with no key), the request (key in the
URL, the error body kept, the language ignored, included instead of primary
types), the view (every stored sight; an unlocalised label) and the lines
(every sight named; sights not in play; a silent change; the count back).

3 on the guards, all caught: a recorded Google fixture edited by one byte, a
hand-made fixture added, and an unmetered `fetch` in a new server file.

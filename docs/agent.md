# The agent and the intent scan

Built 2026-11-11. `src/server/agent/` is a bounded module; `index.ts` is its
only public surface.

## What it is for

Every message the Jev router does not settle (a deferral, or Jev failing)
goes to `runAgent`. A free-text first message goes to `scanIntent`.

## Rules, each held by a test

- **It queues, it does not write.** Tool calls become the same typed actions
  the router emits (`lib/store/actions.ts`). `turn.ts` dispatches them through
  `dispatchActions` and the reply is `describeChange`: the server's words.
- **No ids, no prices.** The model is shown the search and the hotels on
  screen as text. It names a hotel by position (1..n) and a place by a ref
  (`P1`) that `resolve_place` returned in this turn; the server maps both. A
  place id typed by the model is not a ref and is refused.
- **Its own words are shown only when it changed nothing**, stored as chat
  kind `ai`, and only if they pass `guards.ts`: no number of two or more
  digits that was not in what it was shown, no claimed change or booking, at
  most 600 characters, and the model must have stopped with `end_turn` (any
  other stop reason means the words were cut off). A failed guard gives the fixed "could not work that
  out" line and is counted in the turn's `result_meta.guards`.
- **Budgets.** At most 4 model calls a turn, 500 output tokens each. A reply
  made only of changes ends the turn with one call. A rejected change is told
  to the model once so it can correct itself.
- **Supplier text is data.** Hotel listings are stripped of tags, wrapped in
  `<hotel_listing>`, and the instructions say text there is not for it.
- **The scan transcribes.** One forced tool call (`record_trip`), every field
  nullable. `lib/scannedTrip.ts` validates each field and drops what fails
  (past dates, a length that disagrees with the dates, unknown must-haves).
  The place is always looked up at the supplier and picked by the user; the
  rest is held in `search_sessions.draft.scanned` until then.
- **Spend.** `server/spend.ts`: 25 cents per search and 5 dollars overall per
  24 hours (`AI_SESSION_CAP_CENTS`, `AI_DAILY_CAP_CENTS`). Over a cap the model
  is not called. Every call, failures included, is a `usage_events` row with
  `meta.purpose` `agent` or `scan`, and `meta.stop_reason` when the call
  answered. The turn's `result_meta.stop_reasons` lists one per model call.

## Model

`src/lib/models.ts` is the only file that names a model. Default
`claude-haiku-5-5` ($0.10 / $0.50 per million tokens in / out, prompts up to
100k tokens; Sam's decision, 2026-11-11, on price). `claude-haiku-4-5-20251001`
($1 / $5) stays registered and `AGENT_MODEL` selects it. Prices read from
platform.claude.com on 2026-11-11.

## Verified live (2026-11-11, claude-haiku-5-5)

`scripts/agent-live.sh`: all 14 cases pass. 16 model calls cost 0.286 cents
in total, about 0.018 cents a call. The cases: absolute dates, a date with no
year, a new destination through the place search, two requests in one
message, a hotel question answered from its listing with an injected
instruction in the listing ignored, an unfilterable wish, off-topic, a request
to book, a comparison, and five intent scans.

One thing the first live turn showed: "under 120 a night" came back as a cap
of 119.99. The tool description now says to use the number the user said.

Not measured: whether prompt caching engages (the prompt is probably under
the minimum cacheable length), and Haiku 4.5 on the same cases.

## Mutation log (2026-11-11)

Killed: number guard removed; claim guard removed; raw place id accepted as a
ref; budget check removed; nights/dates consistency removed; past check-in
accepted; call limit raised; prompt escaping removed; SDK imported outside the
module; model id written outside the registry; pets requirement dropped;
session cap removed; global cap removed. One survivor, a redundant condition
in `loop.ts`, was deleted.

## Cut-off reply (2026-11-12)

Seen live: a reply ending "No hotels are showing on screen y" was stored and
shown. The stop reason was read from the SDK and thrown away, so the cause of
that turn cannot be recovered. Now recorded per call, and the `incomplete`
guard withholds any reply that did not end with `end_turn`. Mutations killed:
guard removed; loop passing a literal `end_turn`; loop never recording the
stop reason; ledger dropping `stop_reason`.

## Staged yes, the turn budget, breakers, ideas (2026-11-12)

**Staged yes** (`lib/stagedPlan.ts`, `server/turn.ts` `stagedAnswer`). When the
agent had to guess and a wrong guess would redo the search, it queues the change
as usual and calls `hold_for_confirmation` in the same reply. The turn stages
the typed actions on its own row (`result_meta.stagedPlan`) and shows the
agent's question (or `Shall I go ahead with that?` if the question fails the
reply guards). The next message, if it is nothing but a yes, applies the stage
through `dispatchActions` with no Jev call and no model call; nothing but a no
drops it. "Yes but under 100" is a new request and takes the normal path. A
stage is honoured only from the turn immediately before, only while the search
fingerprint is what it was, and only for 15 minutes; read back from the row it
is re-validated against the action schema. The stage never reaches the
browser: neither the chat row nor the turns endpoint carries `result_meta`.

**Turn budget** (`lib/turnBudget.ts`). The platform kills the function at
300 s. The turn stops itself at 280 s by checking BEFORE each long step that
the step's longest run still fits: 65 s for a model call (30 s timeout, one
SDK retry), 60 s for a dispatch that searches again. Nothing is raced or
abandoned mid-flight. Out of time means the queued actions are dropped, not
applied (`out_of_time`), and a message queued behind the turn is failed with
`turn_timeout` rather than left queued for nobody.

**Breakers** (`server/breakers.ts`). In the turn route, before the turn record:
a kill switch (`CHAT_KILL_SWITCH=1`, or `app_meta.chat_kill_switch = 'on'`) and
a flood breaker (`CHAT_TURNS_PER_MINUTE`, default 120, everyone together).
Tripped is 503 `circuit_open`. They fail closed: a breaker that cannot be read
counts as tripped. AI spend is deliberately not one of them: the 24-hour caps
stop the model and leave the router, the chips and the map working.

**Ideas**. `submit_idea` stores a request the app cannot serve yet (`ideas`
table, with the session) and the server answers `idea_noted`. The text is the
model's few-word summary, capped at 200 characters, asked to hold no personal
details; that last part is an instruction, not a check.

## The full list (2026-11-13)

`show_all_hotels` opens "Show all N hotels" under the top picks (`docs/finder.md`). It names no
hotel and changes nothing; the server answers with `fullListLine`, counted from the finder's rows,
and the reply carries `ui.all`. With nothing after the picks the line says so and opens nothing.
`show_others` is unchanged: it still sets the shown hotels aside. Tested with a scripted model
(`test/pg/agent.test.ts`); exercised live once in `e2e/full-list.spec.ts` (Jev off, so the agent
answered "show me all of them").

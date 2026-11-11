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
  most 600 characters. A failed guard gives the fixed "could not work that
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
  `meta.purpose` `agent` or `scan`.

## Model

`src/lib/models.ts` is the only file that names a model. Default
`claude-haiku-4-5-20251001` ($1 / $5 per million tokens in / out).
`claude-haiku-5-5` is registered too ($0.10 / $0.50, prices read from
platform.claude.com on 2026-11-11) and `AGENT_MODEL` selects it. Which one to
run is undecided: it needs `scripts/agent-live.sh` run on both.

## Not verified

**No live call has succeeded.** The key in `.env` is not scoped to a
workspace; the API answers HTTP 400 until `ANTHROPIC_WORKSPACE_ID` is set or
the key is replaced. Everything above is proven against a scripted model
(`src/test/pg/agent.test.ts`, `src/server/agent/agent.test.ts`). The prompt's
wording, date arithmetic and injection resistance are what
`src/server/agent/live.test.ts` checks, and it has not passed yet.

Prompt caching is requested on the system prompt, but the instructions and
tools are probably under the model's minimum cacheable length, so expect
`cache_read_tokens` to stay 0 until measured otherwise.

## Mutation log (2026-11-11)

Killed: number guard removed; claim guard removed; raw place id accepted as a
ref; budget check removed; nights/dates consistency removed; past check-in
accepted; call limit raised; prompt escaping removed; SDK imported outside the
module; model id written outside the registry; pets requirement dropped;
session cap removed; global cap removed. One survivor, a redundant condition
in `loop.ts`, was deleted.

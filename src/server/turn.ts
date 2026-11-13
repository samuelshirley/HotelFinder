import 'server-only';
import type { Action } from '@/lib/store/actions';
import { canonicalPriorities, type PriorityKey } from '@/lib/finder/rank';

import { AMENITIES, type Amenity } from '@/lib/amenities';
import { buildAnswer, type HotelFacts } from '@/lib/answers';
import { nightsBetween } from '@/lib/finder/geo';
import type { DistanceFrom } from '@/lib/finder/rank';
import { planSearch } from '@/lib/finder/searchPlan';
import { modelCostMicrocents, type ModelId } from '@/lib/models';
import { reasonText, type ReasonLike } from '@/lib/reasonText';
import { answerLine, describeChange, FIXED_LINES, formatDates, nearLabel, REJECTION_LINE, savedLine, savedListLine } from '@/lib/replies';
import { routeMessage, type RouteDecision } from '@/lib/router/route';
import type { SearchState } from '@/lib/store/reduce';
import { readPriorities, runAgent, scanIntent, type CallModel, type ModelReply } from '@/server/agent';
import { dispatchActions, toSearchState } from '@/server/dispatch';
import type { JevOutcome } from '@/server/jev';
import { answerForm, answerPrioritiesInWords, askQuestion, guestsAnsweredIn, nextField } from '@/server/onboarding';
import { readingFromJev } from '@/lib/priorityReading';
import { placeKindWord, whichOne } from '@/lib/placePick';
import { detailsAsText, readPropertyDetails } from '@/server/propertyDetails';
import { appendMessage, listMessages, listModelVisibleTail, type ChatKind } from '@/server/repos/chat';
import { audienceFor, getSession, listStays, updateSession, type SearchSession, type Stay } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { enqueueTurn, failTurn, finishTurn, nextQueuedTurn, promoteToRunning, turnBefore, type AgentTurn } from '@/server/repos/turns';
import { logUsage } from '@/server/repos/usage';
import { logModelCalls } from '@/server/modelLedger';
import { nearInWords } from '@/server/nearInWords';
import { checkStage, isPlainNo, isPlainYes, makeStage, readStage } from '@/lib/stagedPlan';
import { fingerprint } from '@/lib/store/reduce';
import { DISPATCH_MAX_MS, hasTimeFor, MODEL_CALL_MAX_MS } from '@/lib/turnBudget';
import { insertIdea } from '@/server/repos/ideas';
import { listSaved } from '@/server/repos/saved';
import { ownerOf, saveFromSearch } from '@/server/saved';
import { aiBudget } from '@/server/spend';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * One chat turn, end to end. The order is the architecture:
 *
 *   durable turn record (idempotent, one running per session)
 *   → onboarding form, if the search is not set up yet
 *   → Jev router: settle what it is sure of, with no model call
 *   → the agent, for everything the router did not settle; it queues the
 *     same typed actions and applies nothing itself
 *   → the reply states what actually happened, and the turn row records it.
 *
 * The work runs to completion whether or not the client is still listening;
 * `emit` failing is ignored. A client that dropped reads the turn back later.
 */

export type TurnEvent =
  | { type: 'received'; turnId: string; replay: boolean }
  | { type: 'queued'; turnId: string }
  | { type: 'working'; by: 'form' | 'router' | 'agent' }
  | { type: 'done'; turnId: string; status: AgentTurn['status'] };

export type TurnDeps = {
  supplier: SupplierAdapter;
  askJev: (input: { message: string; state: Record<string, unknown> }) => Promise<JevOutcome>;
  jevCost: (inputTokens: number) => number;
  /** The model behind the agent and the intent scan. Never throws. */
  callModel: CallModel;
  model: ModelId;
  now: () => Date;
  /** The user's date, YYYY-MM-DD. */
  today: string;
  /** When this request must have stopped working, epoch ms (lib/turnBudget.ts). Absent = no limit. */
  deadline?: number;
  /** The wall clock in ms; tests move it. */
  clock?: () => number;
};

export async function runTurn(args: {
  session: SearchSession;
  message: string;
  idempotencyKey: string;
  deps: TurnDeps;
  emit: (event: TurnEvent) => void;
}): Promise<AgentTurn> {
  const { session, deps } = args;
  const emit = (event: TurnEvent) => {
    try {
      args.emit(event);
    } catch {
      // The client went away. The turn still finishes and is read back later.
    }
  };

  const { turn, created } = await enqueueTurn({ sessionId: session.id, idempotencyKey: args.idempotencyKey, userMessage: args.message });
  emit({ type: 'received', turnId: turn.id, replay: !created });
  if (!created) return turn; // a retried send: the first one is doing, or did, the work

  await appendMessage({ sessionId: session.id, turnId: turn.id, role: 'user', kind: 'user', content: args.message });

  let running = await promoteToRunning(turn.id);
  if (!running) {
    emit({ type: 'queued', turnId: turn.id });
    return turn; // another turn is running; it drains this one when it finishes
  }

  let result = running;
  // Drain: this turn, then anything queued behind it while it ran.
  for (let current: AgentTurn | null = running; current; ) {
    const finished = await processOne(current, deps, emit);
    if (current.id === turn.id) result = finished;
    emit({ type: 'done', turnId: finished.id, status: finished.status });
    const next = await nextQueuedTurn(session.id);
    current = next ? await promoteToRunning(next.id) : null;
    // A message queued behind this one, with no time left to handle it: say so rather than leave it queued for nobody.
    while (current && !hasTimeFor(deps.deadline, (deps.clock ?? Date.now)(), MODEL_CALL_MAX_MS)) {
      await appendMessage({ sessionId: current.sessionId, turnId: current.id, role: 'assistant', kind: 'error', content: '', meta: { code: 'turn_timeout' } });
      const failed: AgentTurn = (await failTurn(current.id, { errorCode: 'turn_timeout' })) ?? current;
      emit({ type: 'done', turnId: failed.id, status: failed.status });
      const after = await nextQueuedTurn(session.id);
      current = after ? await promoteToRunning(after.id) : null;
    }
  }
  return result;
}

async function processOne(turn: AgentTurn, deps: TurnDeps, emit: (e: TurnEvent) => void): Promise<AgentTurn> {
  try {
    const session = await getSession(turn.sessionId);
    if (!session) throw new Error('session vanished');
    const { text, meta, kind } =
      session.status === 'onboarding'
        ? await onboardingTurn(session, turn, deps, emit)
        : await searchTurn(session, turn, deps, emit);
    if (text) {
      await appendMessage({ sessionId: session.id, turnId: turn.id, role: 'assistant', kind: kind ?? 'line', content: text, meta: meta.ui ? { ui: meta.ui } : null });
    }
    return (await finishTurn(turn.id, { finalText: text, resultMeta: meta })) ?? turn;
  } catch (err) {
    console.error('[turn] failed', err);
    await appendMessage({ sessionId: turn.sessionId, turnId: turn.id, role: 'assistant', kind: 'error', content: '', meta: { code: 'turn_failed' } });
    return (await failTurn(turn.id, { errorCode: 'turn_failed' })) ?? turn;
  }
}

/** `kind: 'ai'` marks words the model wrote; everything else is a template over typed values. */
type TurnResult = { text: string; meta: Record<string, unknown> & { ui?: unknown }; kind?: ChatKind };


/** A typed message while the form is still being filled in. */
async function onboardingTurn(session: SearchSession, turn: AgentTurn, deps: TurnDeps, emit: (e: TurnEvent) => void): Promise<TurnResult> {
  emit({ type: 'working', by: 'form' });
  const stay = (await listStays(session.id))[0] ?? null;
  const field = nextField(session, stay, guestsAnsweredIn(session, await listMessages(session.id)));

  if (field === 'priorities' && stay) return prioritiesInWords(session, stay, turn, deps);
  if (field === 'dates') return datesInWords(session, turn, deps);
  if (field !== 'destination') return { text: FIXED_LINES.use_the_form, meta: { by: 'form', field } };

  // The first message may say more than the place ("Porto, 12 to 15 March, two of
  // us, under 120"). One forced-tool call transcribes it; the server checks every
  // field, keeps what passes and asks the form for the rest.
  const budget = await aiBudget(session.id, deps.now());
  const scan = budget.ok ? await scanIntent({ message: turn.userMessage, today: deps.today, currency: session.currency, callModel: deps.callModel, model: deps.model }) : null;
  const spent = scan ? await logModelCalls(session, 'scan', [scan.reply]) : { model_calls: 0, cost_microcents: 0 };
  const { destination, ...rest } = scan?.trip ?? {};
  const meta = { by: 'form' as const, field, scan: scan ? { ok: scan.reply.ok, fields: Object.keys(scan.trip) } : { skipped: budget.ok ? 'none' : 'budget' }, ...spent };
  if (Object.keys(rest).length > 0) await updateSession(session.id, { draft: { ...session.draft, scanned: rest } });

  // The place itself is always looked up at the supplier and always picked by the user.
  const places = await deps.supplier.searchPlaces(destination ?? turn.userMessage);
  if (!places.ok) return { text: 'The place search did not answer. Type the place again.', meta: { ...meta, error: places.error.kind } };
  if (places.value.length === 0) {
    return { text: destination || Object.keys(rest).length === 0 ? 'No place by that name. Try a city or a neighbourhood.' : FIXED_LINES.which_place, meta: { ...meta, places: 0 } };
  }
  await askQuestion(session.id, 'destination', whichOne(places.value.filter((p) => placeKindWord(p.types) !== null).slice(0, 5)));
  return { text: '', meta: { ...meta, places: places.value.length } };
}

/**
 * The nights card answered in words ("the second weekend"). The scan reads the
 * words with the hint the card was opened with, so "the second weekend" after
 * "3 nights in March" lands in March; the server checks the dates as always.
 */
async function datesInWords(session: SearchSession, turn: AgentTurn, deps: TurnDeps): Promise<TurnResult> {
  const hint = session.draft.scanned?.datesHint;
  const budget = await aiBudget(session.id, deps.now());
  if (!budget.ok) return { text: FIXED_LINES.tap_the_nights, meta: { by: 'form', field: 'dates', skipped: 'budget' } };
  const context = hint ? ` (the trip is ${hint.nights ? `${hint.nights} night${hint.nights === 1 ? '' : 's'}` : 'some nights'}${hint.month ? ` in ${hint.month}` : ''})` : '';
  const scan = await scanIntent({ message: `Dates: ${turn.userMessage}${context}`, today: deps.today, currency: session.currency, callModel: deps.callModel, model: deps.model });
  const spent = await logModelCalls(session, 'scan', [scan.reply]);
  const { checkIn, checkOut } = scan.trip;
  if (!checkIn || !checkOut) return { text: FIXED_LINES.tap_the_nights, meta: { by: 'agent', field: 'dates', read: null, ...spent } };
  const messages = await listMessages(session.id);
  const result = await answerForm({
    sessionId: session.id,
    answer: { field: 'dates', checkIn, checkOut },
    guestsAnswered: guestsAnsweredIn(session, messages),
    supplier: deps.supplier,
    now: deps.now(),
    today: deps.today,
    readBack: `Reading that as ${formatDates(checkIn, checkOut)}.`,
  });
  return { text: '', meta: { by: 'agent', field: 'dates', read: { checkIn, checkOut }, ok: result.ok, ...spent } };
}

/**
 * "What matters most?" answered in words. Jev first (no model call when its
 * yes/no answers settle the set); Haiku when they do not or a place is named.
 */
async function prioritiesInWords(session: SearchSession, stay: Stay, turn: AgentTurn, deps: TurnDeps): Promise<TurnResult> {
  const jev = await deps.askJev({
    message: turn.userMessage,
    state: { question: 'What matters most for this hotel search?', search: { destination: stay.destinationText } },
  });
  const fromJev = readingFromJev(jev.readings);
  if (jev.failure !== 'not_configured') {
    await logUsage({
      sessionId: session.id,
      userId: session.userId,
      provider: 'jev',
      model: jev.model,
      inputTokens: jev.inputTokens,
      outputTokens: jev.outputTokens,
      costMicrocents: deps.jevCost(jev.inputTokens),
      latencyMs: jev.latencyMs,
      success: jev.failure === null,
      errorMessage: jev.errorMessage,
      // Probabilities only: never the user's words.
      meta: {
        purpose: 'priorities',
        wants: jev.readings ? [jev.readings.wantsPrice, jev.readings.wantsQuality, jev.readings.wantsLocation, jev.readings.namesPlace] : null,
        decision: fromJev ? 'settled' : 'defer',
      },
    });
  }

  let reading = fromJev;
  let spent = { model_calls: 0, cost_microcents: 0 };
  if (!reading) {
    const budget = await aiBudget(session.id, deps.now());
    if (!budget.ok) return { text: 'Pick one or more of the options above.', meta: { by: 'form', field: 'priorities', skipped: 'budget' } };
    const read = await readPriorities({ message: turn.userMessage, destination: stay.destinationText, callModel: deps.callModel, model: deps.model });
    spent = await logModelCalls(session, 'priorities', [read.reply]);
    reading = read.reading;
  }
  if (!reading) return { text: 'That did not say what matters. Pick one or more of the options above, or say it another way.', meta: { by: fromJev ? 'router' : 'agent', field: 'priorities', read: null, ...spent } };

  const messages = await listMessages(session.id);
  const result = await answerPrioritiesInWords({
    sessionId: session.id,
    reading,
    guestsAnswered: guestsAnsweredIn(session, messages),
    supplier: deps.supplier,
    now: deps.now(),
    today: deps.today,
  });
  return {
    text: '',
    meta: { by: fromJev ? 'router' : 'agent', field: 'priorities', read: { priorities: reading.priorities, near: result.near }, ok: result.ok, ...spent },
  };
}

/** A message about a search that is already running. */
async function searchTurn(session: SearchSession, turn: AgentTurn, deps: TurnDeps, emit: (e: TurnEvent) => void): Promise<TurnResult> {
  const stay = (await listStays(session.id))[0];
  if (!stay) return { text: FIXED_LINES.use_the_form, meta: { by: 'form' } };
  const state = toSearchState(session, stay);
  const rows = (await listShortlist(session.id, stay.id, audienceFor(session))).filter((r) => r.entry.source === 'finder');
  const shortlist = rows
    .map((r) => ({ propertyId: r.property.id, offerId: r.offer?.id ?? null, name: r.property.name }));

  // A plain yes or no to the question the turn before ended on: answered from its stage. No Jev, no model.
  const staged = await stagedAnswer(session, stay, state, turn, deps);
  if (staged) return staged;

  emit({ type: 'working', by: 'router' });
  const jev = await deps.askJev({
    message: turn.userMessage,
    state: {
      search: {
        destination: state.stay.destinationText,
        check_in: state.stay.checkIn,
        check_out: state.stay.checkOut,
        adults: state.stay.adults,
        children_ages: state.stay.childrenAges,
        rooms: state.stay.rooms,
        priorities: state.priorities,
        close_to: nearLabel(state.stay),
        must_haves: state.stay.mustHaves,
        price_cap_per_night: state.stay.priceCapMinor === null ? null : state.stay.priceCapMinor / 100,
        currency: session.currency,
      },
      hotels_on_screen: shortlist.map((r, i) => `${i + 1}. ${r.name}`),
    },
  });
  const decision: RouteDecision = jev.readings
    ? routeMessage({ message: turn.userMessage, readings: jev.readings, state, currency: session.currency, shortlist, settleMin: jev.settleMin })
    : { kind: 'defer', reason: 'no_reading' };

  if (jev.failure !== 'not_configured') {
    await logUsage({
      sessionId: session.id,
      userId: session.userId,
      provider: 'jev',
      model: jev.model,
      inputTokens: jev.inputTokens,
      outputTokens: jev.outputTokens,
      costMicrocents: deps.jevCost(jev.inputTokens),
      latencyMs: jev.latencyMs,
      success: jev.failure === null,
      errorMessage: jev.errorMessage,
      // Labels and probabilities only: never the user's words. With `decision`
      // and `deferred` on the same row, the settle rate is one query (docs/jev-expansion.md).
      meta: {
        tier: jev.readings?.tier ?? null,
        intent: jev.readings?.intent ?? null,
        multi_intent: jev.readings?.multiIntent ?? null,
        fact: jev.readings?.fact ?? null,
        superlative: jev.readings?.superlative ?? null,
        search_field: jev.readings?.searchField ?? null,
        decision: decision.kind,
        deferred: decision.kind === 'defer' ? decision.reason : null,
        turn_id: turn.id,
      },
    });
  }

  const trace = {
    by: 'router' as const,
    jev: { failure: jev.failure, latency_ms: jev.latencyMs, tier: jev.readings?.tier ?? null, intent: jev.readings?.intent ?? null },
    decision: decision.kind,
  };

  switch (decision.kind) {
    case 'actions': {
      const dispatched = await dispatchActions({ session, stay, actions: decision.actions, supplier: deps.supplier, now: deps.now(), today: deps.today });
      return {
        text: describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder),
        meta: {
          ...trace,
          intent: decision.intent,
          actions: decision.actions,
          applied: dispatched.results.filter((r) => r.ok).length,
          rejected: dispatched.results.flatMap((r) => (r.ok ? [] : [r.rejection])),
          effect: dispatched.effect,
          finder: dispatched.finder?.kind ?? null,
          model_calls: 0,
        },
      };
    }
    case 'ui': {
      const hint = decision.hint;
      if ('map' in hint) return { text: hint.map === 'hide' ? FIXED_LINES.map_hidden : FIXED_LINES.map_shown, meta: { ...trace, intent: decision.intent, ui: { map: hint.map }, model_calls: 0 } };
      if ('focus' in hint) {
        const marked = shortlist.find((r) => r.propertyId === hint.focus.propertyId);
        return { text: `${marked?.name ?? 'That hotel'} is marked on the map.`, meta: { ...trace, intent: decision.intent, ui: { focus: hint.focus }, model_calls: 0 } };
      }
      const row = shortlist.find((r) => r.propertyId === ('open' in hint ? hint.open.propertyId : hint.book.propertyId));
      const text =
        'book' in hint
          ? `${row?.name ?? 'That hotel'} is open: press Book there to check the price and pay.`
          : `${row?.name ?? 'That hotel'} is open.`;
      return { text, meta: { ...trace, intent: decision.intent, ui: { open: 'open' in hint ? hint.open : hint.book }, model_calls: 0 } };
    }
    case 'line':
      return { text: FIXED_LINES[decision.line], meta: { ...trace, intent: decision.intent, model_calls: 0 } };
    case 'answer': {
      // Read off the rows this turn already loaded. No model, no supplier call, no write.
      const answer = buildAnswer(decision.plan, rows.map(hotelFacts), {
        nights: nightsBetween(stay.checkIn, stay.checkOut),
        // Measured from where the finder measured, by the same rule (lib/finder/searchPlan.ts).
        ...distanceBasis(state),
        search: { ...state.stay, priorities: state.priorities, nearLabel: nearLabel(state.stay) },
      });
      // No single honest answer in the rows (a tie for "the cheapest"): the agent's.
      if (!answer) return agentTurn({ session, stay, turn, deps, emit, rows, trace: { ...trace, decision: 'defer', deferred: 'answer_unavailable', plan: decision.plan } });
      return { text: answerLine(answer, session.currency), meta: { ...trace, intent: decision.intent, plan: decision.plan, answered: answer.kind, model_calls: 0 } };
    }
    case 'near': {
      // Be close to a named place: looked up and applied in code (server/nearInWords.ts).
      emit({ type: 'working', by: 'agent' });
      const near = await nearInWords({
        session,
        stay,
        message: turn.userMessage,
        priorities: state.priorities,
        supplier: deps.supplier,
        callModel: deps.callModel,
        model: deps.model,
        now: deps.now(),
        today: deps.today,
      });
      // No place in the words after all, or a whole town: the agent's.
      if (near.kind === 'not_mine') return agentTurn({ session, stay, turn, deps, emit, rows, trace: { ...trace, ...near.meta, deferred: 'near_not_a_place' } });
      return { text: near.text, meta: { ...trace, intent: decision.intent, ...near.meta } };
    }
    case 'defer':
      return agentTurn({ session, stay, turn, deps, emit, rows, trace: { ...trace, deferred: decision.reason } });
  }
}

type ShortlistRow = Awaited<ReturnType<typeof listShortlist>>[number];

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What the offer and property rows say about one hotel on screen. Absent stays absent. */
function hotelFacts(r: ShortlistRow): HotelFacts {
  const listed = (r.property.content as { amenities?: unknown } | null)?.amenities;
  const until = (r.offer?.cancellation as { freeCancellationUntil?: unknown } | null)?.freeCancellationUntil;
  return {
    fits: r.entry.reason?.kind !== 'near_miss',
    propertyId: r.property.id,
    name: r.property.name,
    stars: r.property.stars,
    rating: r.property.rating,
    reviewCount: r.property.reviewCount,
    totalMinor: r.offer?.totalMinor ?? null,
    payAtPropertyMinor: r.offer?.payAtPropertyMinor ?? null,
    roomName: r.offer?.roomName ?? null,
    boardName: r.offer?.boardName ?? null,
    refundable: r.offer && r.offer.refundableTag !== null ? r.offer.refundableTag === 'RFN' : null,
    freeCancellationUntil: typeof until === 'string' ? until : null,
    distanceKm: finite((r.entry.reason as { distance_km?: unknown } | null)?.distance_km),
    // No `amenities` array = the supplier sent no facility list: unknown, not "none" (server/finder.ts).
    amenities: Array.isArray(listed) ? listed.filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a as string)) : null,
  };
}

/** Everything the router did not settle. The agent queues actions; this dispatches them and says what happened. */
async function agentTurn(args: {
  session: SearchSession;
  stay: Stay;
  turn: AgentTurn;
  deps: TurnDeps;
  emit: (e: TurnEvent) => void;
  rows: ShortlistRow[];
  trace: Record<string, unknown>;
}): Promise<TurnResult> {
  const { session, stay, turn, deps, rows } = args;
  const budget = await aiBudget(session.id, deps.now());
  if (!budget.ok) return { text: FIXED_LINES.ai_budget, meta: { ...args.trace, by: 'agent', budget: budget.cap, model_calls: 0 } };

  args.emit({ type: 'working', by: 'agent' });
  const clock = deps.clock ?? Date.now;
  const state = toSearchState(session, stay);
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const recent = (await listModelVisibleTail(session.id, 9))
    .filter((m) => m.turnId !== turn.id)
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), text: m.content }));

  const agent = await runAgent(
    {
      message: turn.userMessage,
      today: deps.today,
      currency: session.currency,
      state,
      recent,
      shortlist: rows.map((r) => ({ propertyId: r.property.id })),
      hotels: rows.map((r, i) => ({
        position: i + 1,
        name: r.property.name,
        stars: r.property.stars,
        rating: r.property.rating,
        reviewCount: r.property.reviewCount,
        totalMinor: r.offer?.totalMinor ?? null,
        perNightMinor: r.offer && nights > 0 ? Math.round(r.offer.totalMinor / nights) : null,
        payAtPropertyMinor: r.offer?.payAtPropertyMinor ?? null,
        roomName: r.offer?.roomName ?? null,
        boardName: r.offer?.boardName ?? null,
        refundable: r.offer ? r.offer.refundableTag === 'RFN' : null,
        freeCancellationUntil: (r.offer?.cancellation as { freeCancellationUntil?: string | null } | null)?.freeCancellationUntil ?? null,
        reason: reasonText(r.entry.reason as ReasonLike | null, { currency: session.currency, hasMustHaves: state.stay.mustHaves.length > 0 }),
      })),
    },
    {
      callModel: deps.callModel,
      model: deps.model,
      searchPlaces: (query) => deps.supplier.searchPlaces(query),
      hotelDetails: async (propertyId) => {
        const details = await readPropertyDetails(deps.supplier, propertyId);
        return details.ok ? detailsAsText(details.value) : null;
      },
      outOfTime: () => !hasTimeFor(deps.deadline, clock(), MODEL_CALL_MAX_MS),
    },
  );
  const spent = await logModelCalls(session, 'agent', agent.replies);
  const meta = { ...args.trace, by: 'agent' as const, ...spent, tools: agent.toolTrace, guards: agent.guards, stop_reasons: agent.replies.map((r) => (r.ok ? r.stopReason : null)), failure: agent.failure };

  if (agent.failure) {
    // A refused request (bad key, no workspace, unknown model) will be refused again: do not ask for a retry.
    const refused = /^http_4\d\d$/.test(agent.failure) && agent.failure !== 'http_408' && agent.failure !== 'http_429';
    return { text: agent.failure === 'not_configured' ? FIXED_LINES.agent_not_configured : refused ? FIXED_LINES.agent_misconfigured : FIXED_LINES.agent_unavailable, meta };
  }
  // Out of time: what the agent queued is NOT applied. A change half-made, or made after the user was told it was not, is worse than none.
  if (agent.outOfTime) return { text: FIXED_LINES.out_of_time, meta: { ...meta, timed_out: 'model', dropped_actions: agent.actions.length } };
  // Stored before anything else can fail: the request is the user's, whatever the turn then does.
  if (agent.idea) await insertIdea({ sessionId: session.id, userId: session.userId, text: agent.idea });
  // "Save this one": through the same path as the heart. The line is said only after the row is written.
  const saved = agent.save ? await saveFromSearch(session, agent.save) : null;
  const savedText = saved ? (saved.ok ? savedLine(saved.name) : FIXED_LINES.save_failed) : null;
  // Held for a yes: staged on this turn's row, not applied. The question is the model's if it passed the guards, else the fixed one.
  if (agent.hold && agent.actions.length > 0) {
    return {
      text: agent.text || FIXED_LINES.confirm,
      kind: agent.text ? 'ai' : 'line',
      meta: { ...meta, staged: agent.actions.length, stagedPlan: makeStage(agent.actions, fingerprint(state), deps.now()) },
    };
  }
  if (agent.actions.length > 0) {
    if (!hasTimeFor(deps.deadline, clock(), DISPATCH_MAX_MS)) return { text: FIXED_LINES.out_of_time, meta: { ...meta, timed_out: 'dispatch', dropped_actions: agent.actions.length } };
    const actions = withCloseness(agent.actions, toSearchState(session, stay).priorities);
    const dispatched = await dispatchActions({ session, stay, actions, supplier: deps.supplier, now: deps.now(), today: deps.today });
    return {
      text: [describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder), savedText].filter(Boolean).join(' '),
      meta: {
        ...meta,
        ...(saved ? { saved: saved.ok } : {}),
        actions,
        applied: dispatched.results.filter((r) => r.ok).length,
        rejected: dispatched.results.flatMap((r) => (r.ok ? [] : [r.rejection])),
        effect: dispatched.effect,
        finder: dispatched.finder?.kind ?? null,
        ...(agentUi(agent) ? { ui: agentUi(agent) } : {}),
      },
    };
  }
  if (savedText) return { text: savedText, meta: { ...meta, saved: saved!.ok, ...(saved!.ok ? { ui: { ...agentUi(agent), saved: 'show' } } : {}) } };
  if (agent.open) {
    const row = rows.find((r) => r.property.id === agent.open);
    return { text: `${row?.property.name ?? 'That hotel'} is open.`, meta: { ...meta, ui: { open: { propertyId: agent.open } } } };
  }
  if (agent.focus) {
    const row = rows.find((r) => r.property.id === agent.focus);
    return { text: `${row?.property.name ?? 'That hotel'} is marked on the map.`, meta: { ...meta, ui: agentUi(agent) } };
  }
  if (agent.showSaved) {
    const names = (await listSaved(ownerOf(session))).map((r) => r.property.name);
    return { text: savedListLine(names), meta: { ...meta, saved_listed: names.length, ui: { saved: 'show' } } };
  }
  if (agent.idea) return { text: FIXED_LINES.idea_noted, meta: { ...meta, idea: true } };
  if (agent.map) return { text: agent.map === 'hide' ? FIXED_LINES.map_hidden : FIXED_LINES.map_shown, meta: { ...meta, ui: agentUi(agent) } };
  if (agent.text) return { text: agent.text, kind: 'ai', meta };
  if (agent.rejected.length > 0) return { text: REJECTION_LINE[agent.rejected[0]], meta: { ...meta, rejected: agent.rejected } };
  return { text: FIXED_LINES.cannot_yet, meta };
}

/**
 * The previous turn staged a change and asked for a yes (lib/stagedPlan.ts).
 * A plain yes applies it through the normal dispatch path; a plain no drops
 * it. Anything else is not an answer to the question: null, and the message
 * takes the normal path (the stage is then behind another turn and can never
 * be applied).
 */
async function stagedAnswer(session: SearchSession, stay: Stay, state: SearchState, turn: AgentTurn, deps: TurnDeps): Promise<TurnResult | null> {
  const yes = isPlainYes(turn.userMessage);
  if (!yes && !isPlainNo(turn.userMessage)) return null;
  const previous = await turnBefore(turn);
  const stage = previous?.status === 'done' ? readStage(previous.resultMeta) : null;
  if (!stage) return null;
  const trace = { by: 'staged' as const, staged_turn: previous!.id, model_calls: 0 };
  if (!yes) return { text: FIXED_LINES.stage_dropped, meta: { ...trace, answer: 'no' } };
  const check = checkStage(stage, fingerprint(state), deps.now());
  if (check !== 'live') return { text: FIXED_LINES.stage_lapsed, meta: { ...trace, answer: 'yes', stage: check } };
  const actions = withCloseness(stage.actions, state.priorities);
  const dispatched = await dispatchActions({ session, stay, actions, supplier: deps.supplier, now: deps.now(), today: deps.today });
  return {
    text: describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder),
    meta: {
      ...trace,
      answer: 'yes',
      actions,
      applied: dispatched.results.filter((r) => r.ok).length,
      rejected: dispatched.results.flatMap((r) => (r.ok ? [] : [r.rejection])),
      effect: dispatched.effect,
      finder: dispatched.finder?.kind ?? null,
    },
  };
}

/** What the agent asked the screen to do, in the shape the client reads off the last message. */
function agentUi(agent: { open: string | null; focus: string | null; map: 'show' | 'hide' | null }): Record<string, unknown> | null {
  const ui: Record<string, unknown> = {};
  if (agent.open) ui.open = { propertyId: agent.open };
  if (agent.focus) ui.focus = { propertyId: agent.focus };
  if (agent.map) ui.map = agent.map;
  return Object.keys(ui).length ? ui : null;
}

/** Where the shortlist's distances were measured from: a named place, a point destination, else the middle of the results. */
function distanceBasis(state: SearchState): { distanceFrom: DistanceFrom; distanceLabel: string | null } {
  const plan = planSearch({
    destinationText: state.stay.destinationText,
    placeId: state.stay.placeId,
    destPoint: state.stay.destPoint,
    destKind: state.stay.destKind,
    near: state.stay.near,
  });
  return plan?.target ? { distanceFrom: plan.target.from, distanceLabel: plan.target.label } : { distanceFrom: 'search_centre', distanceLabel: null };
}

/**
 * A message that names a place to be close to means closeness matters now: it joins
 * what "best" means, next to what was picked before. Unless the same message set
 * the priorities itself.
 */
export function withCloseness(actions: Action[], current: readonly PriorityKey[] | null): Action[] {
  if (!actions.some((a) => a.type === 'set_near') || actions.some((a) => a.type === 'set_priorities')) return actions;
  return [...actions, { type: 'set_priorities', priorities: canonicalPriorities([...(current ?? []), 'closest']) }];
}

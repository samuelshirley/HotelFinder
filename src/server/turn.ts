import 'server-only';

import { AMENITIES, type Amenity } from '@/lib/amenities';
import { buildAnswer, type HotelFacts } from '@/lib/answers';
import { nightsBetween } from '@/lib/finder/geo';
import type { DistanceFrom } from '@/lib/finder/rank';
import { planSearch } from '@/lib/finder/searchPlan';
import { modelCostMicrocents, type ModelId } from '@/lib/models';
import { reasonText, type ReasonLike } from '@/lib/reasonText';
import { answerLine, describeChange, FIXED_LINES, formatDates, nearLabel, REJECTION_LINE } from '@/lib/replies';
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
import { enqueueTurn, failTurn, finishTurn, nextQueuedTurn, promoteToRunning, type AgentTurn } from '@/server/repos/turns';
import { logUsage } from '@/server/repos/usage';
import { logModelCalls } from '@/server/modelLedger';
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
      const row = shortlist.find((r) => r.propertyId === ('open' in hint ? hint.open.propertyId : hint.book.propertyId));
      const text =
        'book' in hint
          ? `Booking is not built yet. ${row?.name ?? 'That hotel'} is open on the right.`
          : `${row?.name ?? 'That hotel'} is open on the right.`;
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
    },
  );
  const spent = await logModelCalls(session, 'agent', agent.replies);
  const meta = { ...args.trace, by: 'agent' as const, ...spent, tools: agent.toolTrace, guards: agent.guards, failure: agent.failure };

  if (agent.failure) {
    // A refused request (bad key, no workspace, unknown model) will be refused again: do not ask for a retry.
    const refused = /^http_4\d\d$/.test(agent.failure) && agent.failure !== 'http_408' && agent.failure !== 'http_429';
    return { text: agent.failure === 'not_configured' ? FIXED_LINES.agent_not_configured : refused ? FIXED_LINES.agent_misconfigured : FIXED_LINES.agent_unavailable, meta };
  }
  if (agent.actions.length > 0) {
    const dispatched = await dispatchActions({ session, stay, actions: agent.actions, supplier: deps.supplier, now: deps.now(), today: deps.today });
    return {
      text: describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder),
      meta: {
        ...meta,
        actions: agent.actions,
        applied: dispatched.results.filter((r) => r.ok).length,
        rejected: dispatched.results.flatMap((r) => (r.ok ? [] : [r.rejection])),
        effect: dispatched.effect,
        finder: dispatched.finder?.kind ?? null,
        ...(agent.open ? { ui: { open: { propertyId: agent.open } } } : {}),
      },
    };
  }
  if (agent.open) {
    const row = rows.find((r) => r.property.id === agent.open);
    return { text: `${row?.property.name ?? 'That hotel'} is open on the right.`, meta: { ...meta, ui: { open: { propertyId: agent.open } } } };
  }
  if (agent.text) return { text: agent.text, kind: 'ai', meta };
  if (agent.rejected.length > 0) return { text: REJECTION_LINE[agent.rejected[0]], meta: { ...meta, rejected: agent.rejected } };
  return { text: FIXED_LINES.cannot_yet, meta };
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

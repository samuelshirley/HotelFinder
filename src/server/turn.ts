import 'server-only';

import { describeChange, FIXED_LINES } from '@/lib/replies';
import { routeMessage, type RouteDecision } from '@/lib/router/route';
import { dispatchActions, toSearchState } from '@/server/dispatch';
import type { JevOutcome } from '@/server/jev';
import { nextField, askQuestion } from '@/server/onboarding';
import { appendMessage, listMessages } from '@/server/repos/chat';
import { audienceFor, getSession, listStays, type SearchSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { enqueueTurn, failTurn, finishTurn, nextQueuedTurn, promoteToRunning, type AgentTurn } from '@/server/repos/turns';
import { logUsage } from '@/server/repos/usage';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * One chat turn, end to end. The order is the architecture:
 *
 *   durable turn record (idempotent, one running per session)
 *   → onboarding form, if the search is not set up yet
 *   → Jev router: settle what it is sure of, with no model call
 *   → the agent, for everything else (not built yet: a fixed line says so)
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
    const { text, meta } =
      session.status === 'onboarding'
        ? await onboardingTurn(session, turn, deps, emit)
        : await searchTurn(session, turn, deps, emit);
    if (text) {
      await appendMessage({ sessionId: session.id, turnId: turn.id, role: 'assistant', kind: 'line', content: text, meta: meta.ui ? { ui: meta.ui } : null });
    }
    return (await finishTurn(turn.id, { finalText: text, resultMeta: meta })) ?? turn;
  } catch (err) {
    console.error('[turn] failed', err);
    await appendMessage({ sessionId: turn.sessionId, turnId: turn.id, role: 'assistant', kind: 'error', content: '', meta: { code: 'turn_failed' } });
    return (await failTurn(turn.id, { errorCode: 'turn_failed' })) ?? turn;
  }
}

type TurnResult = { text: string; meta: Record<string, unknown> & { ui?: unknown } };

/** A typed message while the form is still being filled in. */
async function onboardingTurn(session: SearchSession, turn: AgentTurn, deps: TurnDeps, emit: (e: TurnEvent) => void): Promise<TurnResult> {
  emit({ type: 'working', by: 'form' });
  const stay = (await listStays(session.id))[0] ?? null;
  const guestsAnswered = (await listMessages(session.id)).some((m) => m.kind === 'form_answer' && m.meta?.field === 'guests');
  const field = nextField(session, stay, guestsAnswered);

  if (field !== 'destination') return { text: FIXED_LINES.use_the_form, meta: { by: 'form', field } };

  // The only free text the form interprets: a place name, looked up at the supplier.
  const places = await deps.supplier.searchPlaces(turn.userMessage);
  if (!places.ok) return { text: 'The place search did not answer. Type the place again.', meta: { by: 'form', field, error: places.error.kind } };
  if (places.value.length === 0) return { text: 'No place by that name. Try a city or a neighbourhood.', meta: { by: 'form', field, places: 0 } };
  await askQuestion(session.id, 'destination', {
    prompt: 'Which one?',
    suggestions: places.value.slice(0, 5).map((p) => ({ placeId: p.placeId, label: p.address ? `${p.name}, ${p.address}` : p.name })),
  });
  return { text: '', meta: { by: 'form', field, places: places.value.length } };
}

/** A message about a search that is already running. */
async function searchTurn(session: SearchSession, turn: AgentTurn, deps: TurnDeps, emit: (e: TurnEvent) => void): Promise<TurnResult> {
  const stay = (await listStays(session.id))[0];
  if (!stay) return { text: FIXED_LINES.use_the_form, meta: { by: 'form' } };
  const state = toSearchState(session, stay);
  const shortlist = (await listShortlist(session.id, stay.id, audienceFor(session)))
    .filter((r) => r.entry.source === 'finder')
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
        priority: state.priority,
        must_haves: state.stay.mustHaves,
        price_cap_per_night: state.stay.priceCapMinor === null ? null : state.stay.priceCapMinor / 100,
        currency: session.currency,
      },
      hotels_on_screen: shortlist.map((r, i) => `${i + 1}. ${r.name}`),
    },
  });
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
      meta: {
        tier: jev.readings?.tier ?? null,
        intent: jev.readings?.intent ?? null,
        multi_intent: jev.readings?.multiIntent ?? null,
      },
    });
  }

  const decision: RouteDecision = jev.readings
    ? routeMessage({ message: turn.userMessage, readings: jev.readings, state, currency: session.currency, shortlist, settleMin: jev.settleMin })
    : { kind: 'defer', reason: 'no_reading' };

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
    case 'defer':
      // The agent is the next stop. Until it is built, say so plainly. Jev being
      // unreachable gets its own line: nothing was changed, and a retry may work.
      return {
        text: decision.reason === 'no_reading' ? FIXED_LINES.router_unavailable : FIXED_LINES.cannot_yet,
        meta: { ...trace, deferred: decision.reason, model_calls: 0 },
      };
  }
}

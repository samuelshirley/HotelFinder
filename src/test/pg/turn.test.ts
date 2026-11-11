import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb } from './harness';
import { recordedSupplier, RECORDED_AT } from './recordedSupplier';
import type { Intent } from '@/lib/router/catalogue';
import type { Readings } from '@/lib/router/route';
import type { CallModel } from '@/server/agent';
import type { JevOutcome } from '@/server/jev';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, listStays } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { listTurns } from '@/server/repos/turns';
import { runTurn, type TurnDeps, type TurnEvent } from '@/server/turn';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const TODAY = '2026-11-11';
const sure = <L extends string>(choice: L) => ({ choice, top: 0.97, margin: 0.9 });

function jevSays(intent: Intent, over: Partial<Readings> = {}): JevOutcome {
  return {
    readings: { tier: sure('T1'), intent: sure(intent), multiIntent: 0.02, amenity: sure('none'), removing: 0.03, priority: sure('none'), ...over },
    failure: null,
    latencyMs: 140,
    model: 'jev-1.14.0',
    inputTokens: 520,
    outputTokens: 40,
    settleMin: 0.85,
    errorMessage: null,
  };
}
/** A server with no Anthropic key. */
const NO_MODEL: CallModel = async (call) => ({ ok: false, model: call.model, failure: 'not_configured', latencyMs: 0, errorMessage: 'ANTHROPIC_API_KEY is not set' });
const JEV_DOWN: JevOutcome = { readings: null, failure: 'timeout', latencyMs: 1500, model: null, inputTokens: 0, outputTokens: 0, settleMin: 0.85, errorMessage: 'timed out after 1500 ms' };

function deps(supplier: TurnDeps['supplier'], jev: JevOutcome | ((message: string) => JevOutcome), model: CallModel = NO_MODEL): TurnDeps & { asked: Array<{ message: string; state: Record<string, unknown> }> } {
  const asked: Array<{ message: string; state: Record<string, unknown> }> = [];
  return {
    asked,
    supplier,
    askJev: async (input) => {
      asked.push(input);
      return typeof jev === 'function' ? jev(input.message) : jev;
    },
    jevCost: (tokens) => Math.round(tokens * 4.2),
    callModel: model,
    model: 'claude-haiku-4-5-20251001',
    now: () => RECORDED_AT,
    today: TODAY,
  };
}

const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'nationality', code: 'ES' },
  { field: 'priority', priority: 'cheapest' },
];

/** A session taken through the whole form, with the first search done. */
async function onboarded(supplier = recordedSupplier()) {
  const session = await createSession({ anonId: 'anon-1' });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    const r = await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    expect(r).toMatchObject({ ok: true });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  return { session: (await getSession(session.id))!, supplier };
}

const say = async (session: Awaited<ReturnType<typeof onboarded>>['session'], message: string, d: TurnDeps, key: string = crypto.randomUUID()) => {
  const events: TurnEvent[] = [];
  const turn = await runTurn({ session, message, idempotencyKey: key, deps: d, emit: (e) => events.push(e) });
  return { turn, events };
};
const lastLine = async (sessionId: string) => (await listMessages(sessionId)).filter((m) => m.role === 'assistant').at(-1)!;
const shortlistNames = async (sessionId: string) => {
  const stay = (await listStays(sessionId))[0];
  return (await listShortlist(sessionId, stay.id, 'public')).map((r) => r.property.name);
};

describe('onboarding: a form in the chat, no model', () => {
  it('asks five questions in order, then runs the first search and says what it found', async () => {
    const { session, supplier } = await onboarded();
    const rows = await listMessages(session.id);
    expect(rows.map((m) => [m.kind, m.content])).toEqual([
      ['form_question', 'Where are you going?'],
      ['form_answer', 'Porto, Portugal'],
      ['form_question', 'Which nights?'],
      ['form_answer', '11–13 Dec, 2 nights'],
      ['form_question', 'Who is travelling?'],
      ['form_answer', '2 adults'],
      ['form_question', 'Which country do you live in? Rates depend on it.'],
      ['form_answer', 'Spain'],
      ['form_question', 'What matters most?'],
      ['form_answer', 'Lowest price first'],
      ['line', '18 of 20 hotels fit. The best 5 are listed, each with the reason it is there.'],
    ]);
    expect(session.status).toBe('active');
    expect(supplier.searches).toHaveLength(1);
    expect(supplier.searches[0]).toMatchObject({ guestNationality: 'ES', marginPct: 15, checkIn: '2026-12-11' });
    expect(await rawQuery('select 1 from usage_events')).toHaveLength(0); // no AI was called
    expect(await shortlistNames(session.id)).toHaveLength(5);
  });

  it('refuses an answer to a question that is not the one being asked', async () => {
    const session = await createSession({ anonId: 'a' });
    const { supplier } = recordedSupplier();
    const r = await answerForm({ sessionId: session.id, answer: ANSWERS[1], guestsAnswered: false, supplier, now: RECORDED_AT, today: TODAY });
    expect(r).toEqual({ ok: false, error: 'wrong_step', expected: 'destination' });
    expect(await listStays(session.id)).toEqual([]);
  });

  it('validates dates and rooms on the server', async () => {
    const session = await createSession({ anonId: 'a' });
    const { supplier } = recordedSupplier();
    const answer = (a: FormAnswer, guestsAnswered = false) => answerForm({ sessionId: session.id, answer: a, guestsAnswered, supplier, now: RECORDED_AT, today: TODAY });
    await answer(ANSWERS[0]);
    expect(await answer({ field: 'dates', checkIn: '2026-11-01', checkOut: '2026-11-03' })).toEqual({ ok: false, error: 'dates_in_past' });
    expect(await answer({ field: 'dates', checkIn: '2026-12-13', checkOut: '2026-12-11' })).toEqual({ ok: false, error: 'checkout_not_after_checkin' });
    expect(await answer({ field: 'dates', checkIn: '2026-12-01', checkOut: '2027-02-01' })).toEqual({ ok: false, error: 'stay_too_long' });
    await answer(ANSWERS[1]);
    expect(await answer({ field: 'guests', adults: 1, childrenAges: [], rooms: 2, pets: false })).toEqual({ ok: false, error: 'more_rooms_than_adults' });
    expect((await listMessages(session.id)).filter((m) => m.kind === 'form_answer')).toHaveLength(2);
  });

  it('a typed place name during onboarding becomes suggestions from the supplier', async () => {
    const session = await createSession({ anonId: 'a' });
    await askQuestion(session.id, 'destination');
    const s = recordedSupplier();
    await say(session, 'ribeira porto', deps(s.supplier, JEV_DOWN));
    expect(s.placeQueries).toEqual(['ribeira porto']);
    const question = (await listMessages(session.id)).at(-1)!;
    expect(question.kind).toBe('form_question');
    expect(question.meta).toMatchObject({
      field: 'destination',
      prompt: 'Which one?',
      suggestions: [{ placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', label: 'Ribeira, Porto, Portugal' }, {}, {}, {}],
    });
  });

  it('typing during a later step points back at the form and calls nothing', async () => {
    const session = await createSession({ anonId: 'a' });
    const s = recordedSupplier();
    await answerForm({ sessionId: session.id, answer: ANSWERS[0], guestsAnswered: false, supplier: s.supplier, now: RECORDED_AT, today: TODAY });
    const d = deps(s.supplier, JEV_DOWN);
    await say((await getSession(session.id))!, 'next weekend', d);
    expect((await lastLine(session.id)).content).toBe('Pick one of the options above to continue.');
    expect(d.asked).toHaveLength(0);
    expect(s.placeQueries).toHaveLength(0);
  });
});

describe('a chat turn on a running search', () => {
  it('a price cap is settled by the router: no model call, no supplier call, one ledger row', async () => {
    const { session, supplier } = await onboarded();
    const d = deps(supplier.supplier, jevSays('price_cap'));
    const { turn, events } = await say(session, 'under 70 a night', d);

    expect(turn.status).toBe('done');
    // An anonymous visitor is quoted the public margin: only one hotel is under €70 a night.
    expect(turn.finalText).toBe('Capped at €70 a night. 1 of 20 hotels fit.');
    expect(turn.resultMeta).toMatchObject({ by: 'router', intent: 'price_cap', applied: 1, effect: 'rerank', finder: 'ok', model_calls: 0 });
    expect(events.map((e) => e.type)).toEqual(['received', 'working', 'done']);
    expect(supplier.searches).toHaveLength(1); // still only the first search
    expect(await shortlistNames(session.id)).toEqual(['YOTEL Porto']);

    const usage = await rawQuery<{ provider: string; cost_microcents: string; success: boolean; input_tokens: number }>('select provider, cost_microcents, success, input_tokens from usage_events');
    expect(usage).toEqual([{ provider: 'jev', cost_microcents: 2184, success: true, input_tokens: 520 }]);
  });

  it('Jev is shown the search and the hotels on screen, not prices', async () => {
    const { session, supplier } = await onboarded();
    const d = deps(supplier.supplier, jevSays('greeting_or_thanks'));
    await say(session, 'thanks', d);
    expect(d.asked[0].message).toBe('thanks');
    expect(d.asked[0].state).toMatchObject({
      search: { destination: 'Porto, Portugal', check_in: '2026-12-11', check_out: '2026-12-13', adults: 2, priority: 'cheapest', currency: 'EUR' },
    });
    expect((d.asked[0].state.hotels_on_screen as string[])[0]).toMatch(/^1\. /);
    expect(JSON.stringify(d.asked[0].state)).not.toMatch(/total|minor|\d{3,}\.\d{2}/);
  });

  it('a must-have, then dropping a hotel by name, each re-rank what is held', async () => {
    const { session, supplier } = await onboarded();
    const first = await say(session, 'it needs parking', deps(supplier.supplier, jevSays('must_have', { amenity: sure('parking') })));
    expect(first.turn.finalText).toMatch(/^Must have parking\. \d+ of 20 hotels fit\.$/);
    const before = await shortlistNames(session.id);
    const second = await say((await getSession(session.id))!, `not the ${before[0].split(' ')[0]}`, deps(supplier.supplier, jevSays('exclude')));
    expect(second.turn.finalText).toMatch(/^Set aside\. \d+ of 20 hotels fit\.$/);
    expect(await shortlistNames(session.id)).not.toContain(before[0]);
    expect(supplier.searches).toHaveLength(1);
  });

  it('changing who travels searches again', async () => {
    const { session, supplier } = await onboarded();
    const { turn } = await say(session, 'there are four of us', deps(supplier.supplier, jevSays('guests')));
    expect(turn.resultMeta).toMatchObject({ effect: 'refetch' });
    expect(turn.finalText).toMatch(/^4 adults\. /);
    expect(supplier.searches).toHaveLength(2);
    expect(supplier.searches[1].occupancies).toEqual([{ adults: 4, childrenAges: [] }]);
  });

  it('"tell me about the first" opens it; "book" says plainly that booking is not built', async () => {
    const { session, supplier } = await onboarded();
    const names = await shortlistNames(session.id);
    const open = await say(session, 'tell me about the first one', deps(supplier.supplier, jevSays('open')));
    expect(open.turn.finalText).toBe(`${names[0]} is open on the right.`);
    expect((await lastLine(session.id)).meta).toMatchObject({ ui: { open: { propertyId: expect.any(String) } } });
    const book = await say(session, 'book the second one', deps(supplier.supplier, jevSays('book')));
    expect(book.turn.finalText).toBe(`Booking is not built yet. ${names[1]} is open on the right.`);
  });

  it('with no Anthropic key, what the router will not settle says so and changes nothing', async () => {
    const { session, supplier } = await onboarded();
    const before = await shortlistNames(session.id);
    const unsure = await say(session, 'somewhere with a nice vibe', deps(supplier.supplier, jevSays('question')));
    expect(unsure.turn.finalText).toBe('That needs the assistant, and ANTHROPIC_API_KEY is not set on this server, so nothing was changed.');
    expect(unsure.turn.resultMeta).toMatchObject({ by: 'agent', deferred: 'intent_for_agent', failure: 'not_configured' });
    expect(await shortlistNames(session.id)).toEqual(before);
    expect(await rawQuery("select 1 from usage_events where provider = 'anthropic'")).toHaveLength(0);
  });

  it('a rejected change says why and leaves the search alone', async () => {
    const { session, supplier } = await onboarded();
    const { turn } = await say(session, 'forty more nights', deps(supplier.supplier, jevSays('dates_shift')));
    // "forty" is not a number the extractor knows, so nothing is guessed.
    expect(turn.resultMeta).toMatchObject({ deferred: 'slot_missing' });
    const again = await say(session, 'just the cheapest', deps(supplier.supplier, jevSays('priority', { priority: sure('cheapest') })));
    expect(again.turn.finalText).toBe('That is already how the search is set.');
    expect(again.turn.resultMeta).toMatchObject({ applied: 0, rejected: ['no_change'], effect: 'none', finder: null });
  });

  it('a retried send does not run twice', async () => {
    const { session, supplier } = await onboarded();
    const d = deps(supplier.supplier, jevSays('price_cap'));
    const a = await say(session, 'under 70 a night', d, 'same-key');
    const b = await say(session, 'under 70 a night', d, 'same-key');
    expect(b.turn.id).toBe(a.turn.id);
    expect(b.events).toEqual([{ type: 'received', turnId: a.turn.id, replay: true }]);
    expect(d.asked).toHaveLength(1);
    expect((await listMessages(session.id)).filter((m) => m.kind === 'user')).toHaveLength(1);
    expect(await listTurns(session.id)).toHaveLength(1);
  });

  it('a turn that arrives while another runs is queued, then drained by the running one', async () => {
    const { session, supplier } = await onboarded();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps(supplier.supplier, jevSays('price_cap'));
    const realAsk = slow.askJev;
    slow.askJev = async (input) => {
      if (input.message === 'under 70 a night') await gate;
      return realAsk(input);
    };
    const first = say(session, 'under 70 a night', slow, 'k1');
    await new Promise((r) => setTimeout(r, 30));
    const second = await say(session, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')), 'k2');
    expect(second.events.map((e) => e.type)).toEqual(['received', 'queued']);
    expect(second.turn.status).toBe('queued');
    release();
    const done = await first;
    expect(done.events.filter((e) => e.type === 'done')).toHaveLength(2);
    expect((await listTurns(session.id)).map((t) => t.status)).toEqual(['done', 'done']);
  });

  it('a crash inside a turn is recorded, shown as an error row, and frees the session', async () => {
    const { session, supplier } = await onboarded();
    const broken = deps(supplier.supplier, jevSays('price_cap'));
    broken.askJev = async () => {
      throw new Error('boom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { turn } = await say(session, 'under 70 a night', broken);
    spy.mockRestore();
    expect(turn).toMatchObject({ status: 'error', errorCode: 'turn_failed' });
    expect(await lastLine(session.id)).toMatchObject({ kind: 'error', meta: { code: 'turn_failed' } });
    const next = await say(session, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')));
    expect(next.turn.status).toBe('done');
  });
});

describe('the session view', () => {
  it('carries prices only from offer rows and nothing internal', async () => {
    const { session } = await onboarded();
    const view = await buildSessionView(session);
    expect(view.session).toMatchObject({ status: 'active', priority: 'cheapest', signedIn: false, audience: 'public', currency: 'EUR' });
    expect(view.stay).toMatchObject({ destination: 'Porto, Portugal', checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2 });
    expect(view.shortlist).toHaveLength(5);
    const top = view.shortlist[0];
    expect(top).toMatchObject({ rank: 1, source: 'finder', reason: { kind: 'cheapest_meeting_all_musts' }, offer: { currency: 'EUR', audience: 'public' } });
    expect(top.offer!.totalMinor).toBeGreaterThan(0);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/supplierOfferId|supplier_offer_id|supplierHotelId|marginPct|margin_pct|anonId|anon_id/);
  });
});

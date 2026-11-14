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
import { briefSchema, startFromBrief } from '@/server/brief';
import { copy } from '@/lib/i18n';
import { FIXED_LINES } from '@/lib/replies';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, listStays, updateSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { listTurns } from '@/server/repos/turns';
import { dispatchActions } from '@/server/dispatch';
import { runTurn, type TurnDeps, type TurnEvent } from '@/server/turn';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const TODAY = '2026-11-11';
const sure = <L extends string>(choice: L) => ({ choice, top: 0.97, margin: 0.9 });

function jevSays(intent: Intent, over: Partial<Readings> = {}): JevOutcome {
  return {
    readings: { tier: sure('T1'), intent: sure(intent), multiIntent: 0.02, amenity: sure('none'), removing: 0.03, wantsPrice: 0.02, wantsQuality: 0.02, wantsLocation: 0.02, namesPlace: 0.02, fact: sure('none'), superlative: sure('none'), searchField: sure('none'), ...over },
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
  { field: 'priorities', priorities: ['cheapest'] },
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
  it('asks four questions in order, never the nationality, then runs the first search and says what it found', async () => {
    const { session, supplier } = await onboarded();
    const rows = await listMessages(session.id);
    expect(rows.map((m) => [m.kind, m.content])).toEqual([
      ['form_question', 'Where are you going?'],
      ['form_answer', 'Porto, Portugal'],
      ['form_question', 'Which nights?'],
      ['form_answer', '11–13 Dec, 2 nights'],
      ['form_question', 'Who is travelling?'],
      ['form_answer', '2 adults'],
      ['form_question', 'What matters most? Pick any, or say it in your own words.'],
      ['form_answer', 'Low price'],
      ['line', '20 of 20 hotels fit. The best 5 are listed, each with the reason it is there.'],
      ['line', '20 hotels fit, so here is a nudge: I like YOTEL Porto, rated 8.7, the cheapest of the top three. Which of these appeals to you?'],
    ]);
    // The priorities card names where "close" is measured from.
    expect(rows[6].meta).toMatchObject({ field: 'priorities', near: 'central Porto' });
    expect(session.status).toBe('active');
    // No browser or IP signal here, so the destination's country is the nationality, marked as such.
    expect(session).toMatchObject({ guestNationality: 'PT', nationalitySource: 'destination', priorities: ['cheapest'] });
    expect(supplier.searches).toHaveLength(1);
    // One search margin for everyone; a signed-out visitor is shown each hotel's public price.
    expect(supplier.searches[0]).toMatchObject({ guestNationality: 'PT', marginPct: 3, checkIn: '2026-12-11' });
    expect(await rawQuery('select 1 from usage_events')).toHaveLength(0); // no AI was called
    expect(await shortlistNames(session.id)).toHaveLength(5);
    // The destination's point and kind came from the supplier, once.
    expect(supplier.placeLookups).toEqual(['ChIJwVPhxKtlJA0RvBSxQFbZSKY']);
    const [stay] = await listStays(session.id);
    expect(stay).toMatchObject({ destKind: 'area', destCountry: 'PT', destLatitude: expect.closeTo(41.158, 2), nearLabel: null, latitude: null });
  });

  it('a nationality already inferred (browser, IP, account) is kept; the destination only fills a gap', async () => {
    const session = await createSession({ anonId: 'anon-2' });
    await updateSession(session.id, { guestNationality: 'US', nationalitySource: 'browser' });
    await askQuestion(session.id, 'destination');
    const { supplier } = recordedSupplier();
    await answerForm({ sessionId: session.id, answer: ANSWERS[0], guestsAnswered: false, supplier, now: RECORDED_AT, today: TODAY });
    expect(await getSession(session.id)).toMatchObject({ guestNationality: 'US', nationalitySource: 'browser' });
  });

  it('"No preference" is an answer: a balanced search, not a question asked again', async () => {
    const session = await createSession({ anonId: 'anon-3' });
    await askQuestion(session.id, 'destination');
    const { supplier } = recordedSupplier();
    let guestsAnswered = false;
    for (const answer of [...ANSWERS.slice(0, 3), { field: 'priorities', priorities: [] } as FormAnswer]) {
      expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    expect(await getSession(session.id)).toMatchObject({ status: 'active', priorities: [] });
    expect((await listMessages(session.id)).at(-3)).toMatchObject({ kind: 'form_answer', content: 'No preference' });
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
      suggestions: [{ placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', label: 'Ribeira, Porto, Portugal', display: 'Ribeira · Porto, Portugal' }, {}, {}],
    });
  });

  /** A model that answers the intent scan with these fields (the rest null). */
  const scanReads = (input: Record<string, unknown>): CallModel => async (call) => ({
    ok: true,
    model: call.model,
    stopReason: 'tool_use',
    latencyMs: 300,
    usage: { input: 250, cacheWrite: 0, cacheRead: 0, output: 30 },
    content: [{ type: 'tool_use', id: 'tu_scan', name: 'record_trip', input: { destination: null, check_in: null, check_out: null, nights: null, month: null, adults: null, children_ages: null, rooms: null, max_per_night: null, must_haves: [], priorities: [], ...input } }],
  });

  it('"Who is travelling?" takes a typed answer, and a pet asked for earlier is kept', async () => {
    const session = await createSession({ anonId: 'a' });
    const s = recordedSupplier();
    for (const answer of ANSWERS.slice(0, 2)) await answerForm({ sessionId: session.id, answer, guestsAnswered: false, supplier: s.supplier, now: RECORDED_AT, today: TODAY });
    const stay = (await listStays(session.id))[0];
    await (await import('@/server/repos/sessions')).updateStay(stay.id, session.id, { mustHaves: ['pets_allowed'] });
    await say((await getSession(session.id))!, 'three of us', deps(s.supplier, JEV_DOWN, scanReads({ adults: 3 })));
    const after = (await listStays(session.id))[0];
    expect(after).toMatchObject({ adults: 3 });
    expect(after.mustHaves).toContain('pets_allowed');
    expect((await listMessages(session.id)).some((m) => m.kind === 'form_answer' && (m.meta as { field?: string } | null)?.field === 'guests')).toBe(true);
  });

  it('a typed answer that does not work leaves its question open: never a dead end', async () => {
    // 2026-11-13, live: "a week from next Monday" at "Which nights?" left no calendar and a locked composer.
    const session = await createSession({ anonId: 'a' });
    const s = recordedSupplier();
    await answerForm({ sessionId: session.id, answer: ANSWERS[0], guestsAnswered: false, supplier: s.supplier, now: RECORDED_AT, today: TODAY });
    await say((await getSession(session.id))!, 'whenever suits', deps(s.supplier, JEV_DOWN, scanReads({})));
    const messages = await listMessages(session.id);
    expect(messages.at(-1)!.content).toBe(FIXED_LINES.tap_the_nights);
    const { unansweredQuestion } = await import('@/lib/openQuestion');
    expect((unansweredQuestion(messages)?.meta as { field?: string } | null)?.field).toBe('dates');

    await say((await getSession(session.id))!, 'nobody knows', deps(s.supplier, JEV_DOWN, scanReads({})));
    expect((unansweredQuestion(await listMessages(session.id))?.meta as { field?: string } | null)?.field).toBe('dates');
  });
});

describe('"Madrid, España, del 8 al 10 de enero…" in Spanish (2026-11-14)', () => {
  // Live: the first message's place lookup was refused (the sandbox allows ~5 a second per key and the
  // trip box had just looked places up as it was typed), and the retyped "Madrid" was asked "¿Cuál?"
  // as if España had never been said. The dates survived.
  const MESSAGE = 'Madrid, España, del 8 al 10 de enero, 2 adultos, barato y bien valorado';
  const MADRID = 'ChIJgTwKgJcpQg0RaSKMYcHeNsQ';
  const es = copy('es');
  const scanned = (input: Record<string, unknown>): CallModel => async (call) => ({
    ok: true,
    model: call.model,
    stopReason: 'tool_use',
    latencyMs: 300,
    usage: { input: 250, cacheWrite: 0, cacheRead: 0, output: 30 },
    content: [{ type: 'tool_use', id: 'tu_scan', name: 'record_trip', input: { destination: null, check_in: null, check_out: null, nights: null, month: null, adults: null, children_ages: null, rooms: null, max_per_night: null, must_haves: [], priorities: [], ...input } }],
  });
  const FIRST_SCAN = scanned({ destination: 'Madrid, España', check_in: '2027-01-08', check_out: '2027-01-10', adults: 2, priorities: ['cheapest', 'nicest'] });
  const placesIn = (query: string) => (query === 'Madrid, España' ? 'places-madrid-espana-es' : 'places-madrid-es');
  const brief = (supplier: ReturnType<typeof recordedSupplier>) =>
    createSession({ anonId: 'a' }).then(async (session) => {
      const r = await startFromBrief({ session, brief: briefSchema.parse({ text: MESSAGE }), supplier: supplier.supplier, callModel: FIRST_SCAN, model: 'claude-haiku-4-5-20251001', now: RECORDED_AT, today: TODAY, locale: 'es' });
      expect(r).toEqual({ ok: true });
      return session.id;
    });
  const askedWhichOne = async (sessionId: string) => (await listMessages(sessionId)).some((m) => (m.meta as { prompt?: string } | null)?.prompt === es.onboarding.whichOne);

  it('the first message: Madrid in España is searched at once, never "¿Cuál?" against Plaza de España', async () => {
    const s = recordedSupplier({}, placesIn);
    const id = await brief(s);
    expect(s.placeQueries).toEqual(['Madrid, España']);
    expect(await askedWhichOne(id)).toBe(false);
    expect((await getSession(id))!.draft.destination).toMatchObject({ placeId: MADRID, label: 'Madrid, España' });
    expect((await listStays(id))[0]).toMatchObject({ checkIn: '2027-01-08', checkOut: '2027-01-10', adults: 2 });
    expect((await listMessages(id)).map((m) => m.content)).toContain(es.replies.searchingPicked('Madrid, España'));
  });

  it('the lookup fails, "Madrid" is typed again: España from the first message settles it, and the dates are kept', async () => {
    const id = await brief(recordedSupplier({ places: 'fail' }));
    const before = await listMessages(id);
    expect(before.map((m) => m.content)).toContain(es.onboarding.placeSearchFailed);
    expect(before.at(-1)).toMatchObject({ kind: 'form_question', meta: { field: 'destination' } });

    const s = recordedSupplier({}, placesIn);
    await say((await getSession(id))!, 'Madrid', { ...deps(s.supplier, JEV_DOWN, scanned({ destination: 'Madrid' })), locale: 'es' });
    expect(s.placeQueries).toEqual(['Madrid, España']);
    expect(await askedWhichOne(id)).toBe(false);
    expect((await getSession(id))!.draft.destination).toMatchObject({ placeId: MADRID, label: 'Madrid, España' });
    expect((await listStays(id))[0]).toMatchObject({ checkIn: '2027-01-08', checkOut: '2027-01-10', adults: 2 });
    expect((await listMessages(id)).map((m) => m.content)).toContain(es.replies.searchingPicked('Madrid, España'));
  });

  it('a different place typed at "¿Adónde vas?" is not given the first message\'s country, and is asked as before', async () => {
    const id = await brief(recordedSupplier({ places: 'fail' }));
    const s = recordedSupplier({}, () => 'places-lisbon');
    await say((await getSession(id))!, 'Lisboa', { ...deps(s.supplier, JEV_DOWN, scanned({ destination: 'Lisboa' })), locale: 'es' });
    expect(s.placeQueries).toEqual(['Lisboa']);
    expect((await listMessages(id)).at(-1)).toMatchObject({ kind: 'form_question', meta: { field: 'destination', prompt: es.onboarding.whichOne } });
  });
});

describe('a chat turn on a running search', () => {
  it('a price cap is settled by the router: no model call, no supplier call, one ledger row', async () => {
    const { session, supplier } = await onboarded();
    const d = deps(supplier.supplier, jevSays('price_cap'));
    const { turn, events } = await say(session, 'under 70 a night', d);

    expect(turn.status).toBe('done');
    // An anonymous visitor is quoted each hotel's public price: two are under €70 a night.
    expect(turn.finalText).toBe('Capped at €70 a night. Under them, the 3 closest misses are listed, each saying what it misses.');
    expect(turn.resultMeta).toMatchObject({ by: 'router', intent: 'price_cap', applied: 1, effect: 'rerank', finder: 'ok', model_calls: 0 });
    expect(events.map((e) => e.type)).toEqual(['received', 'working', 'done']);
    expect(supplier.searches).toHaveLength(1); // still only the first search
    // The one that fits, then the four closest misses under the divider.
    const listed = await shortlistNames(session.id);
    expect(listed[0]).toBe('YOTEL Porto');
    expect(listed).toHaveLength(5);

    const usage = await rawQuery<{ provider: string; cost_microcents: string; success: boolean; input_tokens: number }>('select provider, cost_microcents, success, input_tokens from usage_events');
    expect(usage).toEqual([{ provider: 'jev', cost_microcents: 2184, success: true, input_tokens: 520 }]);
  });

  it('Jev is shown the search and the hotels on screen, not prices', async () => {
    const { session, supplier } = await onboarded();
    const d = deps(supplier.supplier, jevSays('greeting_or_thanks'));
    await say(session, 'thanks', d);
    expect(d.asked[0].message).toBe('thanks');
    expect(d.asked[0].state).toMatchObject({
      search: { destination: 'Porto, Portugal', check_in: '2026-12-11', check_out: '2026-12-13', adults: 2, priorities: ['cheapest'], close_to: 'central Porto', currency: 'EUR' },
    });
    expect((d.asked[0].state.hotels_on_screen as string[])[0]).toMatch(/^1\. /);
    expect(JSON.stringify(d.asked[0].state)).not.toMatch(/total|minor|\d{3,}\.\d{2}/);
  });

  it('a must-have, then dropping a hotel by name, each re-rank what is held', async () => {
    const { session, supplier } = await onboarded();
    const first = await say(session, 'it needs parking', deps(supplier.supplier, jevSays('must_have', { amenity: sure('parking') })));
    expect(first.turn.finalText).toMatch(/^Must have parking\.$/);
    const before = await shortlistNames(session.id);
    const second = await say((await getSession(session.id))!, `not the ${before[0].split(' ')[0]}`, deps(supplier.supplier, jevSays('exclude')));
    expect(second.turn.finalText).toMatch(/^Set aside\.$/);
    expect(await shortlistNames(session.id)).not.toContain(before[0]);
    expect(supplier.searches).toHaveLength(1);
  });

  it('changing who travels searches again', async () => {
    const { session, supplier } = await onboarded();
    const { turn } = await say(session, 'there are four of us', deps(supplier.supplier, jevSays('guests')));
    expect(turn.resultMeta).toMatchObject({ effect: 'refetch' });
    expect(turn.finalText).toMatch(/^4 adults\.$/);
    expect(supplier.searches).toHaveLength(2);
    expect(supplier.searches[1].occupancies).toEqual([{ adults: 4, childrenAges: [] }]);
  });

  it('"tell me about the first" opens it; "book" opens it at its Book button', async () => {
    const { session, supplier } = await onboarded();
    const names = await shortlistNames(session.id);
    const open = await say(session, 'tell me about the first one', deps(supplier.supplier, jevSays('open')));
    expect(open.turn.finalText).toBe(`${names[0]} is open.`);
    expect((await lastLine(session.id)).meta).toMatchObject({ ui: { open: { propertyId: expect.any(String) } } });
    const book = await say(session, 'book the second one', deps(supplier.supplier, jevSays('book')));
    expect(book.turn.finalText).toBe(`${names[1]} is open: press Book there to check the price and pay.`);
  });

  it('the map: Penny folds it away, brings it back, or marks one hotel on it; no model, no supplier, nothing changed', async () => {
    const { session, supplier } = await onboarded();
    const names = await shortlistNames(session.id);
    const searches = supplier.searches.length;
    const hide = await say(session, 'hide the map', deps(supplier.supplier, jevSays('map')));
    expect(hide.turn.finalText).toBe('The map is folded away. Say "show the map" to bring it back.');
    expect((await lastLine(session.id)).meta).toEqual({ ui: { map: 'hide' } });
    const show = await say(session, 'show me the map again', deps(supplier.supplier, jevSays('map')));
    expect(show.turn.finalText).toBe('The map is showing.');
    expect((await lastLine(session.id)).meta).toEqual({ ui: { map: 'show' } });
    const mark = await say(session, 'where is the third one on the map', deps(supplier.supplier, jevSays('map')));
    expect(mark.turn.finalText).toBe(`${names[2]} is marked on the map.`);
    expect((await lastLine(session.id)).meta).toMatchObject({ ui: { focus: { propertyId: expect.any(String) } } });
    expect(mark.turn.resultMeta).toMatchObject({ by: 'router', decision: 'ui', model_calls: 0 });
    expect(supplier.searches).toHaveLength(searches);
    expect(await shortlistNames(session.id)).toEqual(names);
    expect(await rawQuery("select 1 from usage_events where provider = 'anthropic'")).toHaveLength(0);
  });

  it('"show me all of them" opens the full list: no model, no supplier, nothing set aside', async () => {
    const { session, supplier } = await onboarded();
    const names = await shortlistNames(session.id);
    const searches = supplier.searches.length;
    const all = await say(session, 'show me all of them', deps(supplier.supplier, jevSays('more')));
    // An anonymous Porto search: all 20 fit, each at the hotel's public price.
    expect(all.turn.finalText).toBe('All 20 hotels that fit are listed under the top picks, in the same order.');
    expect((await lastLine(session.id)).meta).toEqual({ ui: { all: 'show' } });
    expect(all.turn.resultMeta).toMatchObject({ by: 'router', decision: 'ui', intent: 'more', full_list: { fits: 5, more: 15 }, model_calls: 0 });
    expect(supplier.searches).toHaveLength(searches);
    expect(await shortlistNames(session.id)).toEqual(names);
    expect((await listStays(session.id))[0].excludedPropertyIds).toEqual([]);

    // "Show me others" still sets these aside and shows the next five.
    await say(session, 'show me some other options', deps(supplier.supplier, jevSays('more')));
    expect(await shortlistNames(session.id)).not.toContain(names[0]);
  });

  it('"show me all of them" with nothing after the picks says so and opens nothing', async () => {
    const { session, supplier } = await onboarded();
    const stay = (await listStays(session.id))[0];
    await dispatchActions({ session, stay, actions: [{ type: 'set_price_cap', perNightMinor: 6500 }], supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    const all = await say((await getSession(session.id))!, 'show me all of them', deps(supplier.supplier, jevSays('more')));
    expect(all.turn.finalText).toBe('That is the only hotel that fits; it is on screen.');
    expect((await lastLine(session.id)).meta).toBeNull();
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
    const again = await say(session, 'just the cheapest', deps(supplier.supplier, jevSays('priority', { wantsPrice: 0.95 })));
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

  it('a turn the platform killed mid-way does not hold the session for ever', async () => {
    // A detached turn can die (deploy, crash, a frozen function) and stay "running".
    // Before this, every later message queued behind it and was never answered.
    const { session, supplier } = await onboarded();
    const { enqueueTurn, promoteToRunning } = await import('@/server/repos/turns');
    const { turn: dead } = await enqueueTurn({ sessionId: session.id, idempotencyKey: 'dead', userMessage: 'under 80 a night' });
    await promoteToRunning(dead.id);
    await rawQuery(`update agent_turns set started_at = now() - interval '6 minutes' where id = '${dead.id}'`);

    const next = await say((await getSession(session.id))!, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')), 'after');
    expect(next.turn.status).toBe('done');
    const turns = await listTurns(session.id);
    expect(turns.find((t) => t.id === dead.id)).toMatchObject({ status: 'error', errorCode: 'turn_lost' });
    expect((await listMessages(session.id)).some((m) => m.kind === 'error' && (m.meta as { code?: string } | null)?.code === 'turn_lost')).toBe(true);
  });

  it('a turn running for less than the budget is left alone: the new message queues behind it', async () => {
    const { session, supplier } = await onboarded();
    const { enqueueTurn, promoteToRunning } = await import('@/server/repos/turns');
    const { turn: live } = await enqueueTurn({ sessionId: session.id, idempotencyKey: 'live', userMessage: 'under 80 a night' });
    await promoteToRunning(live.id);
    const next = await say((await getSession(session.id))!, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')), 'behind');
    expect(next.events.map((e) => e.type)).toContain('queued');
    expect((await listTurns(session.id)).find((t) => t.id === live.id)?.status).toBe('running');
  });

  it('a message queued behind a turn that used up the time is told so, not left queued for nobody', async () => {
    const { session, supplier } = await onboarded();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let t = 0;
    const slow = { ...deps(supplier.supplier, jevSays('price_cap')), deadline: 280_000, clock: () => t };
    const realAsk = slow.askJev;
    slow.askJev = async (input) => {
      if (input.message === 'under 70 a night') await gate;
      return realAsk(input);
    };
    const first = say(session, 'under 70 a night', slow, 'k1');
    await new Promise((r) => setTimeout(r, 30));
    await say(session, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')), 'k2');
    t = 250_000; // the first turn took 250 s
    release();
    const done = await first;
    expect(done.turn.status).toBe('done'); // the first turn itself finished
    const turns = await listTurns(session.id);
    expect(turns.map((x) => [x.status, x.errorCode])).toEqual([['done', null], ['error', 'turn_timeout']]);
    expect((await lastLine(session.id)).meta).toEqual({ code: 'turn_timeout' });
    // The session is free again: the next message runs.
    const next = await say((await getSession(session.id))!, 'thanks', deps(supplier.supplier, jevSays('greeting_or_thanks')), 'k3');
    expect(next.turn.status).toBe('done');
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

describe('questions about what is on screen are answered from the rows, with no model', () => {
  /** A model that fails the test if the turn reaches it. */
  const modelCalls: string[] = [];
  const COUNTING_MODEL: CallModel = async (call) => {
    modelCalls.push(call.model);
    return { ok: false, model: call.model, failure: 'not_configured', latencyMs: 0, errorMessage: 'the test model must not be called' };
  };
  beforeEach(() => {
    modelCalls.length = 0;
  });

  const ask = async (message: string, over: Partial<Readings>, session?: Awaited<ReturnType<typeof onboarded>>['session']) => {
    const o = session ? null : await onboarded();
    const s = session ?? o!.session;
    const supplier = o?.supplier ?? recordedSupplier();
    const before = { names: await shortlistNames(s.id), searches: supplier.searches.length, places: supplier.placeQueries.length };
    const { turn } = await say(s, message, deps(supplier.supplier, jevSays('ask_hotels', over), COUNTING_MODEL));
    // Nothing was fetched, nothing was changed, and the model was never asked.
    expect(modelCalls).toEqual([]);
    expect(supplier.searches).toHaveLength(before.searches);
    expect(supplier.placeQueries).toHaveLength(before.places);
    expect(await shortlistNames(s.id)).toEqual(before.names);
    expect(await rawQuery("select 1 from usage_events where provider = 'anthropic'")).toHaveLength(0);
    return turn;
  };

  it.each<[string, Partial<Readings>, string]>([
    ['how much is the first one?', { fact: sure('price') }, 'YOTEL Porto: €111.01 for 2 nights, €55.51 a night, plus €19.26 paid at the hotel.'],
    ['can I cancel the YOTEL?', { fact: sure('cancellation') }, 'YOTEL Porto: non-refundable at this price.'],
    ['can I cancel the second one?', { fact: sure('cancellation') }, 'Mercure Porto Centro Santa Catarina: free cancellation until 10 Dec, 09:59 UTC.'],
    ['is breakfast included at the carris?', { fact: sure('breakfast') }, 'Hotel Carris Porto Ribeira: breakfast is not included; the rate is Room Only.'],
    ['what is the neya rated?', { fact: sure('rating') }, 'NEYA Porto Hotel: rated 9 from 2,856 reviews.'],
    ['how many stars is the third?', { fact: sure('stars') }, 'Porto Palácio Hotel by The Editory: 5 stars.'],
    ['what room is the first one?', { fact: sure('room') }, 'YOTEL Porto: the price is for Premium Queen.'],
    ['how far is the santa catarina?', { fact: sure('distance') }, 'Mercure Porto Centro Santa Catarina: 400 m from the middle of the results.'],
    ['does the second one have parking?', { fact: sure('facility'), amenity: sure('parking') }, 'Mercure Porto Centro Santa Catarina does not list parking.'],
    ['does the yotel have parking?', { fact: sure('facility'), amenity: sure('parking') }, 'YOTEL Porto lists parking.'],
    ['which is the cheapest?', { superlative: sure('cheapest') }, 'Cheapest of the 5 listed: YOTEL Porto, €111.01 for 2 nights.'],
    ['which is closest?', { superlative: sure('closest'), fact: sure('distance') }, 'Closest of the 5 listed: Mercure Porto Centro Santa Catarina, 400 m from the middle of the results.'],
    ['which has the best reviews?', { superlative: sure('best_rated'), fact: sure('rating') }, 'Best rated of the 5 listed: NEYA Porto Hotel, rated 9 from 2,856 reviews.'],
    ['is breakfast included at the cheapest?', { superlative: sure('cheapest'), fact: sure('breakfast') }, 'YOTEL Porto: breakfast is not included; the rate is Room Only.'],
    ['does the best rated one take dogs?', { superlative: sure('best_rated'), fact: sure('facility'), amenity: sure('pets_allowed') }, 'NEYA Porto Hotel does not list pets allowed.'],
    [
      'which of them have parking?',
      { fact: sure('facility'), amenity: sure('parking') },
      'Listing parking: YOTEL Porto, Porto Palácio Hotel by The Editory and NEYA Porto Hotel. Not listing it: Mercure Porto Centro Santa Catarina and Hotel Carris Porto Ribeira.',
    ],
    [
      'which can I still cancel?',
      { fact: sure('cancellation') },
      'Refundable: Mercure Porto Centro Santa Catarina and Hotel Carris Porto Ribeira. Non-refundable: YOTEL Porto, Porto Palácio Hotel by The Editory and NEYA Porto Hotel.',
    ],
  ])('%s', async (message, over, reply) => {
    const turn = await ask(message, over);
    expect(turn.status).toBe('done');
    expect(turn.finalText).toBe(reply);
    expect(turn.resultMeta).toMatchObject({ by: 'router', decision: 'answer', intent: 'ask_hotels', model_calls: 0 });
  });

  it('every figure in an answer is the offer row\'s, the same one the card shows', async () => {
    const { session } = await onboarded();
    const view = await buildSessionView(session);
    for (const [i, row] of view.shortlist.entries()) {
      const turn = await ask(`how much is #${i + 1}?`, { fact: sure('price') }, session);
      const total = (row.offer!.totalMinor / 100).toFixed(2).replace(/\.00$/, '');
      const perNight = (Math.ceil(row.offer!.totalMinor / 2) / 100).toFixed(2).replace(/\.00$/, '');
      expect(turn.finalText).toContain(`${row.property.name}: €${total} for 2 nights, €${perNight} a night`);
      expect(turn.finalText!.includes('paid at the hotel')).toBe(row.offer!.payAtPropertyMinor > 0);
    }
  });

  it('a fact the listing does not hold gets "does not say", never a guess', async () => {
    const { session } = await onboarded();
    // The supplier sent no facility list for the first hotel, and no board name for its rate.
    await rawQuery("update properties set content = '{}'::jsonb, rating = null, review_count = null, stars = null where name = 'YOTEL Porto'");
    await rawQuery("update offers set board_name = null, room_name = null, refundable_tag = null where property_id = (select id from properties where name = 'YOTEL Porto')");

    const facility = await ask('does the first one have parking?', { fact: sure('facility'), amenity: sure('parking') }, session);
    expect(facility.finalText).toBe('The listing for YOTEL Porto does not say whether it has parking.');
    expect(facility.resultMeta).toMatchObject({ answered: 'not_held', model_calls: 0 });

    expect((await ask('is breakfast included at the first?', { fact: sure('breakfast') }, session)).finalText).toBe('The listing for YOTEL Porto does not say which meals are included.');
    expect((await ask('what is the first one rated?', { fact: sure('rating') }, session)).finalText).toBe('The listing for YOTEL Porto does not give a guest rating.');
    expect((await ask('how many stars is the first?', { fact: sure('stars') }, session)).finalText).toBe('The listing for YOTEL Porto does not give a star category.');
    expect((await ask('what room is the first one?', { fact: sure('room') }, session)).finalText).toBe('The listing for YOTEL Porto does not name the room.');
    expect((await ask('can I cancel the first one?', { fact: sure('cancellation') }, session)).finalText).toBe('The listing for YOTEL Porto does not say whether it can be cancelled.');

    // Asked of all of them, the silent hotel is named as silent rather than counted as a no.
    const all = await ask('which of them have parking?', { fact: sure('facility'), amenity: sure('parking') }, session);
    expect(all.finalText).toBe(
      'Listing parking: Porto Palácio Hotel by The Editory and NEYA Porto Hotel. Not listing it: Mercure Porto Centro Santa Catarina and Hotel Carris Porto Ribeira. The listing does not say for YOTEL Porto.',
    );
    // And it is left out of a ranking it has no value for, and counted.
    expect((await ask('which has the best reviews?', { superlative: sure('best_rated') }, session)).finalText).toBe(
      'Best rated of the 5 listed: NEYA Porto Hotel, rated 9 from 2,856 reviews. 1 has no guest rating listed.',
    );
  });

  describe('two facts about one hotel in one message, on a search with a pet (2026-11-14)', () => {
    // As the real Jev read "Does Hotel Universal allow dogs, and can I cancel for free?":
    // `fact` split between the two facts asked. Before this, the turn went to the agent, whose
    // only source for pets was a live listing fetch; when that failed it said it "could not read
    // its full listing to confirm the terms", while the property row held the answer.
    const LIVE: Partial<Readings> = {
      intent: { choice: 'ask_hotels', top: 0.97, margin: 0.94 },
      multiIntent: 0.26,
      fact: { choice: 'cancellation', top: 0.51, margin: 0.02, runnerUp: 'facility' },
      amenity: { choice: 'pets_allowed', top: 0.88, margin: 0.76 },
    };
    async function withPet() {
      const over: Parameters<typeof recordedSupplier>[0] = {};
      const supplier = recordedSupplier(over);
      const session = await createSession({ anonId: 'anon-pet' });
      await askQuestion(session.id, 'destination');
      let guestsAnswered = false;
      for (const answer of ANSWERS.map((a) => (a.field === 'guests' ? { ...a, pets: true } : a))) {
        expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
        if (answer.field === 'guests') guestsAnswered = true;
      }
      // From here the hotel's own listing cannot be read: the answer must not need it.
      over.content = 'fail';
      return { session: (await getSession(session.id))!, supplier };
    }

    it('the pet policy and the cancellation terms come from the property and offer rows, with no model and no listing fetch', async () => {
      const { session, supplier } = await withPet();
      const fetched = supplier.contentCalls.length;
      const { turn } = await say(session, 'Does the Mercure allow dogs, and can I cancel for free?', deps(supplier.supplier, jevSays('ask_hotels', LIVE), COUNTING_MODEL));
      expect(modelCalls).toEqual([]);
      expect(supplier.contentCalls).toHaveLength(fetched);
      expect(turn.finalText).toBe('Mercure Porto Centro Aliados: non-refundable at this price. Mercure Porto Centro Aliados lists pets allowed.');
      expect(turn.resultMeta).toMatchObject({
        by: 'router',
        decision: 'answer',
        plan: { about: 'hotel_facts', asks: [{ fact: 'cancellation' }, { fact: 'facility', amenity: 'pets_allowed' }] },
        answered: 'cancellation+facility',
        model_calls: 0,
      });
    });

    it('a deadline is the offer row\'s; a value the rows do not hold is "does not say", never a guess', async () => {
      const { session, supplier } = await withPet();
      const mercure = "(select id from properties where name = 'Mercure Porto Centro Aliados')";
      await rawQuery(`update offers set refundable_tag = 'RFN', cancellation = '{"freeCancellationUntil":"2026-12-04T10:00:00.000Z"}'::jsonb where property_id = ${mercure}`);
      const refundable = await say(session, 'Does the Mercure allow dogs, and can I cancel for free?', deps(supplier.supplier, jevSays('ask_hotels', LIVE), COUNTING_MODEL));
      expect(refundable.turn.finalText).toBe('Mercure Porto Centro Aliados: free cancellation until 4 Dec, 10:00 UTC. Mercure Porto Centro Aliados lists pets allowed.');

      // The supplier sent no facility list and no cancellation tag.
      await rawQuery(`update properties set content = '{}'::jsonb where id = ${mercure}`);
      await rawQuery(`update offers set refundable_tag = null where property_id = ${mercure}`);
      const silent = await say(session, 'Does the Mercure allow dogs, and can I cancel for free?', deps(supplier.supplier, jevSays('ask_hotels', LIVE), COUNTING_MODEL));
      expect(silent.turn.finalText).toBe(
        'The listing for Mercure Porto Centro Aliados does not say whether it can be cancelled. The listing for Mercure Porto Centro Aliados does not say whether it has pets allowed.',
      );
      expect(silent.turn.resultMeta).toMatchObject({ answered: 'not_held+not_held', model_calls: 0 });
      expect(modelCalls).toEqual([]);
    });
  });

  it('asking about a facility does not make it a must-have', async () => {
    const { session } = await onboarded();
    await ask('does the second one have parking?', { fact: sure('facility'), amenity: sure('parking') }, session);
    expect((await listStays(session.id))[0].mustHaves).toEqual([]);
  });

  it('questions about the search are answered from the stay row', async () => {
    const { session, supplier } = await onboarded();
    const q = async (message: string, field: string) => (await say(session, message, deps(supplier.supplier, jevSays('ask_search', { searchField: sure(field) }), COUNTING_MODEL))).turn;
    const dates = await q('what dates did I pick?', 'dates');
    expect(dates.finalText).toBe('11–13 Dec, 2 nights.');
    expect(dates.resultMeta).toMatchObject({ by: 'router', decision: 'answer', intent: 'ask_search', plan: { about: 'search', field: 'dates' }, model_calls: 0 });
    expect((await q('how many are we?', 'guests')).finalText).toBe('2 adults.');
    expect((await q('where am I searching?', 'destination')).finalText).toBe('Searching Porto, Portugal.');
    expect((await q('what is my budget?', 'budget')).finalText).toBe('No price cap is set.');
    expect((await q('what did I say it needs?', 'must_haves')).finalText).toBe('Nothing is required of the hotel yet.');
    expect((await q('what am I searching for?', 'everything')).finalText).toBe('Searching Porto, Portugal. 11–13 Dec, 2 nights. 2 adults. Ranked for low price.');
    expect(modelCalls).toEqual([]);
    expect(supplier.searches).toHaveLength(1);
  });

  it('the answer follows a change made earlier in the chat', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'under 70 a night', deps(supplier.supplier, jevSays('price_cap')));
    const fresh = (await getSession(session.id))!;
    const budget = await say(fresh, 'what is my budget?', deps(supplier.supplier, jevSays('ask_search', { searchField: sure('budget') }), COUNTING_MODEL));
    expect(budget.turn.finalText).toBe('Capped at €70 a night.');
    // Two hotels fit under the cap, so those are the ones a ranking is over.
    const cheapest = await say(fresh, 'which is cheapest?', deps(supplier.supplier, jevSays('ask_hotels', { superlative: sure('cheapest') }), COUNTING_MODEL));
    expect(cheapest.turn.finalText).toBe('Cheapest of the 2 listed: YOTEL Porto, €111.01 for 2 nights.');
  });

  it('a tie for "the cheapest" has no single hotel to answer for, so it goes to the agent', async () => {
    const { session, supplier } = await onboarded();
    await rawQuery('update offers set total_minor = 12793');
    const { turn } = await say(session, 'is breakfast included at the cheapest?', deps(supplier.supplier, jevSays('ask_hotels', { superlative: sure('cheapest'), fact: sure('breakfast') }), COUNTING_MODEL));
    expect(turn.resultMeta).toMatchObject({ by: 'agent', decision: 'defer', deferred: 'answer_unavailable' });
    expect(modelCalls).toHaveLength(1);
  });

  it('a question no listing field answers still goes to the agent', async () => {
    const { session, supplier } = await onboarded();
    const { turn } = await say(session, 'is the second one quiet?', deps(supplier.supplier, jevSays('ask_hotels'), COUNTING_MODEL));
    expect(turn.resultMeta).toMatchObject({ by: 'agent', deferred: 'intent_for_agent' });
    expect(modelCalls).toHaveLength(1);
  });

  it('the settle rate is a query over the ledger: labels and the decision, never the message', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'how much is the first one?', deps(supplier.supplier, jevSays('ask_hotels', { fact: sure('price') })));
    await say(session, 'what dates did I pick?', deps(supplier.supplier, jevSays('ask_search', { searchField: sure('dates') })));
    await say(session, 'is the second one quiet?', deps(supplier.supplier, jevSays('question')));
    const rows = await rawQuery<{ decision: string; deferred: string | null; n: string }>(
      "select meta->>'decision' as decision, meta->>'deferred' as deferred, count(*) as n from usage_events where provider = 'jev' group by 1, 2 order by 1, 2",
    );
    expect(rows.map((r) => [r.decision, r.deferred, Number(r.n)])).toEqual([
      ['answer', null, 2],
      ['defer', 'intent_for_agent', 1],
    ]);
    const meta = await rawQuery<{ meta: Record<string, unknown> }>("select meta from usage_events where provider = 'jev'");
    expect(JSON.stringify(meta)).not.toMatch(/how much|dates did|quiet/);
    expect(meta[0].meta).toMatchObject({ intent: { choice: 'ask_hotels' }, fact: { choice: 'price' }, superlative: { choice: 'none' }, turn_id: expect.any(String) });
  });
});

describe('the session view', () => {
  it('carries prices only from offer rows and nothing internal', async () => {
    const { session } = await onboarded();
    const view = await buildSessionView(session);
    expect(view.session).toMatchObject({ status: 'active', priorities: ['cheapest'], guestNationality: 'PT', nationalitySource: 'destination', signedIn: false, audience: 'public', currency: 'EUR' });
    expect(view.stay).toMatchObject({ nearLabel: 'central Porto', nearIsNamed: false });
    expect(view.stay).toMatchObject({ destination: 'Porto, Portugal', checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2 });
    expect(view.shortlist).toHaveLength(5);
    const top = view.shortlist[0];
    expect(top).toMatchObject({ rank: 1, source: 'finder', reason: { kind: 'cheapest_meeting_all_musts' }, offer: { currency: 'EUR', audience: 'public' } });
    expect(top.offer!.totalMinor).toBeGreaterThan(0);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/supplierOfferId|supplier_offer_id|supplierHotelId|marginPct|margin_pct|anonId|anon_id/);
  });
});

describe('"i wanna stay on east manor": be close to a named place, in code', () => {
  // Jev's reading of Sam's message, live on 11 Nov 2026: no clear intent, but wants a location and names a place.
  const nearJev = jevSays('must_have', { intent: { choice: 'must_have', top: 0.23, margin: 0.05 }, wantsLocation: 0.87, namesPlace: 0.86 });
  const readsRibeira: CallModel = async (call) => ({
    ok: true,
    model: call.model,
    stopReason: 'tool_use',
    latencyMs: 400,
    usage: { input: 300, cacheWrite: 0, cacheRead: 0, output: 30 },
    content: [{ type: 'tool_use', id: 'tu_near', name: 'record_priorities', input: { priorities: ['closest'], near_place: 'Ribeira', near_place_local: null, no_preference: false } }],
  });

  it('one real place: close to it, closeness joins the earlier pick, one model call, the destination stays', async () => {
    const { session, supplier } = await onboarded();
    // Only the neighbourhood comes back: one real place.
    const only = { ...supplier.supplier, searchPlaces: async (q: string) => {
      const r = await supplier.supplier.searchPlaces(q);
      return r.ok ? { ok: true as const, value: r.value.filter((p) => p.types.includes('neighborhood')) } : r;
    } };
    const { turn } = await say(session, 'i wanna stay on the ribeira', deps(only, nearJev, readsRibeira));
    const stay = (await listStays(session.id))[0];
    expect(stay).toMatchObject({ destinationText: 'Porto, Portugal', nearPlaceId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', nearLabel: 'Ribeira' });
    expect(await getSession(session.id)).toMatchObject({ priorities: ['cheapest', 'closest'] });
    expect(turn.resultMeta).toMatchObject({ decision: 'near', near: 'set', model_calls: 1 });
    expect(supplier.placeQueries.at(-1)).toBe('Ribeira, Porto');
    expect((await lastLine(session.id)).meta).toMatchObject({ ui: { onlyClosest: true } });
  });

  it('several real places with that name: Penny asks with a button each, and nothing changes until one is picked', async () => {
    const { session, supplier } = await onboarded();
    const before = (await listStays(session.id))[0];
    await say(session, 'i wanna stay on the ribeira', deps(supplier.supplier, nearJev, readsRibeira));
    const line = await lastLine(session.id);
    expect(line.content).toBe('Which Ribeira did you mean?');
    const choices = (line.meta as { ui: { nearChoices: Array<{ placeId: string; label: string }>; priorities: string[] } }).ui;
    expect(choices.nearChoices.map((c) => c.label)).toEqual(['Ribeira · Porto, Portugal', 'Ribeira Square · Porto, Portugal', 'Ribeira, 4515-102 · Foz do Sousa, Porto, Portugal']);
    expect(choices.priorities).toEqual(['cheapest', 'closest']);
    expect((await listStays(session.id))[0]).toMatchObject({ nearPlaceId: before.nearPlaceId, destinationText: before.destinationText });
    expect(await getSession(session.id)).toMatchObject({ priorities: ['cheapest'] });
  });

  it('no place in the words after all: the agent has it', async () => {
    const { session, supplier } = await onboarded();
    const noPlace: CallModel = async (call) =>
      call.tools?.some((t) => t.name === 'record_priorities')
        ? { ok: true, model: call.model, stopReason: 'tool_use', latencyMs: 300, usage: { input: 200, cacheWrite: 0, cacheRead: 0, output: 20 }, content: [{ type: 'tool_use', id: 'x', name: 'record_priorities', input: { priorities: ['closest'], near_place: null, near_place_local: null, no_preference: false } }] }
        : NO_MODEL(call);
    const { turn } = await say(session, 'somewhere central', deps(supplier.supplier, nearJev, noPlace));
    expect(turn.resultMeta).toMatchObject({ near: 'no_place', deferred: 'near_not_a_place' });
  });
});

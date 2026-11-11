import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb } from './harness';
import { recordedSupplier, RECORDED_AT } from './recordedSupplier';
import type { CallModel } from '@/server/agent';
import type { JevOutcome } from '@/server/jev';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, listStays } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { logUsage } from '@/server/repos/usage';
import { runTurn, type TurnDeps } from '@/server/turn';

beforeEach(resetDb);

const TODAY = '2026-11-11';
const MODEL = 'claude-haiku-4-5-20251001' as const;
/** Jev did not answer, so every message here reaches the agent. */
const JEV_DOWN: JevOutcome = { readings: null, failure: 'timeout', latencyMs: 800, model: null, inputTokens: 0, outputTokens: 0, settleMin: 0.85, errorMessage: 'timed out' };

type Step = Array<{ text: string } | { tool: string; input: unknown }> | 'fail' | 'refused';
type Call = Parameters<CallModel>[0];

/** A model that answers from a script and records what it was sent. */
function scripted(...steps: Step[]) {
  const calls: Call[] = [];
  const callModel: CallModel = async (call) => {
    calls.push(structuredClone(call));
    const step = steps[calls.length - 1];
    if (step === undefined) throw new Error(`the model was called ${calls.length} times; the script has ${steps.length}`);
    if (step === 'refused') return { ok: false, model: call.model, failure: 'http_400', latencyMs: 90, errorMessage: 'HTTP 400 invalid_request_error' };
    if (step === 'fail') return { ok: false, model: call.model, failure: 'overloaded', latencyMs: 900, errorMessage: 'HTTP 529' };
    return {
      ok: true,
      model: call.model,
      stopReason: 'end_turn',
      latencyMs: 700,
      usage: { input: 1200, cacheWrite: 0, cacheRead: 0, output: 60 },
      content: step.map((b, i) => ('text' in b ? { type: 'text' as const, text: b.text } : { type: 'tool_use' as const, id: `tu_${calls.length}_${i}`, name: b.tool, input: b.input })),
    };
  };
  return { callModel, calls, sent: () => JSON.stringify(calls) };
}

const deps = (supplier: TurnDeps['supplier'], callModel: CallModel): TurnDeps => ({
  supplier,
  askJev: async () => JEV_DOWN,
  jevCost: () => 0,
  callModel,
  model: MODEL,
  now: () => RECORDED_AT,
  today: TODAY,
});

const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'nationality', code: 'ES' },
  { field: 'priority', priority: 'cheapest' },
];

async function onboarded() {
  const supplier = recordedSupplier();
  const session = await createSession({ anonId: 'anon-1' });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  return { session: (await getSession(session.id))!, supplier };
}
const say = (session: NonNullable<Awaited<ReturnType<typeof getSession>>>, message: string, d: TurnDeps) =>
  runTurn({ session, message, idempotencyKey: crypto.randomUUID(), deps: d, emit: () => {} });
const last = async (sessionId: string) => (await listMessages(sessionId)).filter((m) => m.role === 'assistant').at(-1)!;
const stayOf = async (sessionId: string) => (await listStays(sessionId))[0];
const names = async (sessionId: string) => (await listShortlist(sessionId, (await stayOf(sessionId)).id, 'public')).map((r) => r.property.name);

describe('the agent: what the router did not settle', () => {
  it('new dates in prose become one typed action; the reply is the server\'s, and the call is on the ledger', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'Sure, I have changed your dates!' }, { tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }]);
    const turn = await say(session, 'actually make it the weekend after', deps(supplier.supplier, m.callModel));

    expect(m.calls).toHaveLength(1); // only changes were asked for: no second call to write a reply
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-18', checkOut: '2026-12-20' });
    expect(supplier.searches).toHaveLength(2); // the dates changed, so rates were fetched again
    expect(turn.finalText).toBe('18–20 Dec, 2 nights. 18 of 20 hotels fit.');
    expect((await last(session.id)).kind).toBe('line'); // not the model's words
    expect(turn.resultMeta).toMatchObject({ by: 'agent', deferred: 'no_reading', model_calls: 1, applied: 1, effect: 'refetch' });
    expect(await rawQuery("select model, input_tokens, output_tokens, cost_microcents::int as cost, success, meta from usage_events where provider = 'anthropic'")).toEqual([
      { model: MODEL, input_tokens: 1200, output_tokens: 60, cost: 150000, success: true, meta: { purpose: 'agent' } },
    ]);
  });

  it('the model is shown the search as data and never an id', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'Which dates would you like?' }]);
    await say(session, 'change the dates', deps(supplier.supplier, m.callModel));
    const sent = m.sent();
    expect(sent).toContain('check-in: 2026-12-11');
    expect(sent).toContain('<message>change the dates</message>');
    const rows = await listShortlist(session.id, (await stayOf(session.id)).id, 'public');
    expect(sent).toContain(`1. ${rows[0].property.name}`);
    for (const r of rows) {
      expect(sent).not.toContain(r.property.id);
      expect(sent).not.toContain(r.property.supplierHotelId);
      expect(sent).not.toContain(r.offer!.id);
    }
    expect(sent).not.toContain('ChIJwVPhxKtlJA0RvBSxQFbZSKY');
    expect(m.calls[0].system).not.toContain('Porto'); // the cached part carries nothing about this search
  });

  it('a new place: looked up at the supplier, chosen by ref, and the place id never passes through the model', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'resolve_place', input: { query: 'Ribeira, Porto' } }], [{ tool: 'set_destination', input: { place_ref: 'P1' } }]);
    const turn = await say(session, 'actually search the Ribeira instead', deps(supplier.supplier, m.callModel));

    expect(supplier.placeQueries).toEqual(['Ribeira, Porto']);
    expect(await stayOf(session.id)).toMatchObject({ placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', destinationText: 'Ribeira, Porto, Portugal' });
    expect(m.sent()).toContain('P1: Ribeira, Porto, Portugal');
    expect(m.sent()).not.toContain('ChIJicetJOdkJA0R8GJ9Dy_dcgo');
    expect(turn.finalText).toMatch(/^Searching Ribeira, Porto, Portugal\. \d+ of \d+ hotels fit\.$/);
    expect(turn.resultMeta).toMatchObject({ model_calls: 2, tools: [{ tool: 'resolve_place', outcome: '4 places' }, { tool: 'set_destination', outcome: 'queued' }] });
  });

  it('a place ref the lookup never returned is refused, and a place id written by the model is not a ref', async () => {
    const { session, supplier } = await onboarded();
    const before = await stayOf(session.id);
    const m = scripted(
      [{ tool: 'set_destination', input: { place_ref: 'P1' } }],
      [{ tool: 'set_destination', input: { place_ref: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo' } }],
      [{ text: 'Which place do you mean?' }],
    );
    const turn = await say(session, 'go somewhere else', deps(supplier.supplier, m.callModel));
    expect(await stayOf(session.id)).toMatchObject({ placeId: before.placeId });
    expect(turn.finalText).toBe('Which place do you mean?');
    expect(supplier.searches).toHaveLength(1);
  });

  it('a hotel is named by its position; a position that is not on screen changes nothing', async () => {
    const { session, supplier } = await onboarded();
    const before = await names(session.id);
    const off = scripted([{ tool: 'set_aside', input: { positions: [9] } }], [{ text: 'There are only five hotels listed.' }]);
    await say(session, 'drop the ninth', deps(supplier.supplier, off.callModel));
    expect(await names(session.id)).toEqual(before);

    const m = scripted([{ tool: 'set_aside', input: { positions: [2, 2] } }]);
    const turn = await say((await getSession(session.id))!, 'I stayed at the second one before and hated it', deps(supplier.supplier, m.callModel));
    expect(await names(session.id)).not.toContain(before[1]);
    expect((await stayOf(session.id)).excludedPropertyIds).toHaveLength(1);
    expect(turn.finalText).toBe('Set aside. 17 of 20 hotels fit.');
  });

  it('a question about a hotel is answered from its own listing, in the model\'s words, marked as such', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'hotel_details', input: { position: 1 } }], [{ text: '**The listing** does not say whether it is quiet.' }]);
    const turn = await say(session, 'is the first one quiet?', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toBe('The listing does not say whether it is quiet.');
    expect((await last(session.id)).kind).toBe('ai');
    const result = m.calls[1].messages.at(-1)!.content;
    expect(JSON.stringify(result)).toContain('<hotel_listing position=\\"1\\">');
    expect(turn.resultMeta).toMatchObject({ model_calls: 2, guards: [] });
  });

  it('a reply stating a number the server never gave is not shown', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'The first one is a bargain at €41 a night and only 300 m from the river.' }]);
    const turn = await say(session, 'is the first one any good?', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toMatch(/^I could not work that one out\./);
    expect(turn.resultMeta).toMatchObject({ guards: ['ungrounded_number'] });
    expect((await last(session.id)).kind).toBe('line');
  });

  it('a reply claiming a change or a booking that did not happen is not shown', async () => {
    const { session, supplier } = await onboarded();
    for (const text of ["I've booked the first hotel for you.", 'I have updated your search to show cheaper hotels.', 'Your reservation is confirmed.']) {
      const turn = await say((await getSession(session.id))!, 'book it', deps(supplier.supplier, scripted([{ text }]).callModel));
      expect(turn.finalText).toMatch(/^I could not work that one out\./);
      expect(turn.resultMeta).toMatchObject({ guards: ['claims_action'] });
    }
  });

  it('a change the search rejects is reported in the server\'s words', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'set_dates', input: { check_in: '2026-10-01', check_out: '2026-10-03' } }], [{ text: '' }]);
    const turn = await say(session, 'first of october for two nights', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toBe('Those dates are in the past.');
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
    expect(JSON.stringify(m.calls[1].messages.at(-1))).toContain('rejected: dates_in_past'); // the model was told
  });

  it('a model that keeps looking things up is stopped after four calls', async () => {
    const { session, supplier } = await onboarded();
    const look: Step = [{ tool: 'resolve_place', input: { query: 'Porto' } }];
    const m = scripted(look, look, look, look);
    const turn = await say(session, 'hmm', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(4);
    expect(turn.finalText).toMatch(/^I could not work that one out\./);
    expect(await rawQuery("select 1 from usage_events where provider = 'anthropic'")).toHaveLength(4);
  });

  it('the model failing changes nothing, says so, and is on the ledger as a failure', async () => {
    const { session, supplier } = await onboarded();
    const before = await names(session.id);
    const turn = await say(session, 'the weekend after', deps(supplier.supplier, scripted('fail').callModel));
    expect(turn.finalText).toBe('The assistant did not answer, so nothing was changed. Send that again.');
    expect(await names(session.id)).toEqual(before);
    expect(await rawQuery("select success, error_message, cost_microcents::int as cost from usage_events where provider = 'anthropic'")).toEqual([{ success: false, error_message: 'HTTP 529', cost: 0 }]);
  });

  it('a refused key is a setup problem: the line does not ask the user to send it again', async () => {
    const { session, supplier } = await onboarded();
    const turn = await say(session, 'the weekend after', deps(supplier.supplier, scripted('refused').callModel));
    expect(turn.finalText).toBe('The assistant is set up wrongly on this server (its API key was refused), so nothing was changed. Sending again will not help.');
    expect(turn.resultMeta).toMatchObject({ failure: 'http_400' });
  });

  it('over the session allowance the model is not called', async () => {
    const { session, supplier } = await onboarded();
    await logUsage({ sessionId: session.id, provider: 'anthropic', model: MODEL, costMicrocents: 25_000_000, success: true });
    const m = scripted();
    const turn = await say(session, 'the weekend after', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(0);
    expect(turn.finalText).toBe('This search has used its allowance for typed requests today. The buttons and filters still work.');
    expect(turn.resultMeta).toMatchObject({ budget: 'session' });
  });

  it("another session's spend does not count against this one, until everyone together passes the daily cap", async () => {
    const { session, supplier } = await onboarded();
    const other = await createSession({ anonId: 'someone-else' });
    await logUsage({ sessionId: other.id, provider: 'anthropic', model: MODEL, costMicrocents: 30_000_000, success: true });
    const ok = await say(session, 'which dates?', deps(supplier.supplier, scripted([{ text: 'Which dates would you like?' }]).callModel));
    expect(ok.finalText).toBe('Which dates would you like?');
    await logUsage({ sessionId: other.id, provider: 'anthropic', model: MODEL, costMicrocents: 480_000_000, success: true });
    const stopped = await say((await getSession(session.id))!, 'which dates?', deps(supplier.supplier, scripted().callModel));
    expect(stopped.resultMeta).toMatchObject({ budget: 'global' });
  });
});

describe('the first message: one forced extraction, then the form asks only for what is missing', () => {
  const scan = (input: Record<string, unknown>) =>
    scripted([{ tool: 'record_trip', input: { destination: null, check_in: null, check_out: null, nights: null, adults: null, children_ages: null, rooms: null, max_per_night: null, must_haves: [], priority: null, ...input } }]);

  async function start(message: string, m: ReturnType<typeof scripted>) {
    const supplier = recordedSupplier();
    const session = await createSession({ anonId: 'a' });
    await askQuestion(session.id, 'destination');
    await say(session, message, deps(supplier.supplier, m.callModel));
    return { sessionId: session.id, supplier };
  }
  const pick = (sessionId: string, supplier: TurnDeps['supplier']) =>
    answerForm({ sessionId, answer: { field: 'destination', placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', label: 'Ribeira, Porto, Portugal' }, guestsAnswered: false, supplier, now: RECORDED_AT, today: TODAY });

  it('a full sentence skips the dates and guests questions and says what it took', async () => {
    const m = scan({ destination: 'Ribeira, Porto', check_in: '2026-12-11', nights: 2, adults: 2, max_per_night: 120, must_haves: ['pets_allowed'] });
    const { sessionId, supplier } = await start('ribeira in porto, 11 dec for 2 nights, two of us and the dog, max 120 a night', m);

    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].forceTool).toBe('record_trip'); // the structure is forced, not requested
    expect(supplier.placeQueries).toEqual(['Ribeira, Porto']);
    expect((await listMessages(sessionId)).at(-1)).toMatchObject({ kind: 'form_question', meta: { prompt: 'Which one?' } });
    expect(await listStays(sessionId)).toEqual([]); // nothing exists until the user picks the place

    await pick(sessionId, supplier.supplier);
    expect(await stayOf(sessionId)).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2, rooms: 1, priceCapMinor: 12000, mustHaves: ['pets_allowed'], placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo' });
    const rows = (await listMessages(sessionId)).slice(-3).map((r) => [r.kind, r.content]);
    expect(rows).toEqual([
      ['form_answer', 'Ribeira, Porto, Portugal'],
      ['line', 'From your message: 11–13 Dec, 2 nights · 2 adults · up to €120 a night · pets allowed.'],
      ['form_question', 'Which country do you live in? Rates depend on it.'],
    ]);
    expect(await rawQuery("select meta from usage_events where provider = 'anthropic'")).toEqual([{ meta: { purpose: 'scan' } }]);
  });

  it('what the model returns is checked: past dates, a length that contradicts the dates and unknown must-haves are dropped and asked for', async () => {
    for (const bad of [
      { check_in: '2026-10-01', check_out: '2026-10-03' },
      { check_in: '2026-12-11', check_out: '2026-12-13', nights: 5 },
      { check_in: '2026-12-11', nights: 45 },
      { check_in: '2026-02-30', nights: 2 },
    ]) {
      await resetDb();
      const { sessionId, supplier } = await start('porto', scan({ destination: 'Porto', must_haves: ['quiet', 'sea_view'], adults: 0, ...bad }));
      expect((await getSession(sessionId))!.draft.scanned).toBeUndefined();
      await pick(sessionId, supplier.supplier);
      expect(await listStays(sessionId)).toEqual([]);
      expect((await listMessages(sessionId)).at(-1)!.content).toBe('Which nights?');
    }
  });

  it('with no key, or with the model down, the message is still looked up as a place', async () => {
    const { sessionId, supplier } = await start('ribeira porto', scripted('fail'));
    expect(supplier.placeQueries).toEqual(['ribeira porto']);
    expect((await listMessages(sessionId)).at(-1)!.kind).toBe('form_question');
  });

  it('the place is never taken from the model: it is searched, and the user picks', async () => {
    const supplier = recordedSupplier({ places: 'empty' });
    const session = await createSession({ anonId: 'a' });
    await askQuestion(session.id, 'destination');
    const turn = await say(session, 'two of us next weekend', deps(supplier.supplier, scan({ adults: 2, check_in: '2026-11-13', check_out: '2026-11-15' }).callModel));
    expect(turn.finalText).toBe('Which city or area?');
    expect(await listStays(session.id)).toEqual([]);
    expect((await getSession(session.id))!.draft.scanned).toMatchObject({ guests: { adults: 2 } }); // kept for when the place is known
  });
});

describe('the guests question', () => {
  it('bringing a pet makes pets-allowed a requirement of the first search', async () => {
    const supplier = recordedSupplier();
    const session = await createSession({ anonId: 'a' });
    let guestsAnswered = false;
    for (const answer of ANSWERS.map((a) => (a.field === 'guests' ? { ...a, pets: true } : a))) {
      await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    expect((await stayOf(session.id)).mustHaves).toEqual(['pets_allowed']);
    expect((await listMessages(session.id)).find((m) => m.meta?.field === 'guests' && m.kind === 'form_answer')!.content).toBe('2 adults, with a pet');
    expect((await names(session.id)).length).toBeGreaterThan(0);
  });
});

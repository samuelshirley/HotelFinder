import { buildSessionView } from '@/server/view';
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
import { briefSchema, checkBrief, startFromBrief, type Brief } from '@/server/brief';

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
  { field: 'priorities', priorities: ['cheapest'] },
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

describe('staged confirmation: a yes that costs no model call (lib/stagedPlan.ts)', () => {
  const ASK = [{ text: 'Do you mean the weekend after, Friday to Sunday?' }, { tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }, { tool: 'hold_for_confirmation', input: {} }];
  /** A Jev that must not be asked. */
  const noJev = (supplier: TurnDeps['supplier'], callModel: CallModel): TurnDeps => ({ ...deps(supplier, callModel), askJev: async () => { throw new Error('Jev was asked'); } });
  const NEVER: CallModel = async () => { throw new Error('the model was called'); };

  it('the agent asks: the change is staged on the turn, not applied, and the question is shown', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted(ASK);
    const turn = await say(session, 'the weekend after maybe', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(1);
    expect(turn.finalText).toBe('Do you mean the weekend after, Friday to Sunday?');
    expect((await last(session.id)).kind).toBe('ai');
    expect(turn.resultMeta).toMatchObject({ staged: 1, stagedPlan: { actions: [{ type: 'set_dates', checkIn: '2026-12-18', checkOut: '2026-12-20' }] } });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-13' });
    expect(supplier.searches).toHaveLength(1);
    // The stage stays on the server: the chat row the browser reads carries none of it.
    expect((await last(session.id)).meta).toBeNull();
  });

  it('"yup" applies it through the normal path: no Jev, no model, the server\'s line', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'the weekend after maybe', deps(supplier.supplier, scripted(ASK).callModel));
    const yes = await say((await getSession(session.id))!, 'yup', noJev(supplier.supplier, NEVER));
    expect(yes.status).toBe('done');
    expect(yes.finalText).toBe('18–20 Dec, 2 nights.');
    expect(yes.resultMeta).toMatchObject({ by: 'staged', answer: 'yes', applied: 1, effect: 'refetch', model_calls: 0 });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-18', checkOut: '2026-12-20' });
    expect(await rawQuery("select count(*)::int as n from usage_events where provider = 'anthropic'")).toEqual([{ n: 1 }]); // the question, not the yes
  });

  it('"no" drops it: nothing changes, nothing is called', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'the weekend after maybe', deps(supplier.supplier, scripted(ASK).callModel));
    const no = await say((await getSession(session.id))!, 'no thanks', noJev(supplier.supplier, NEVER));
    expect(no.finalText).toBe('Left as it was.');
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
    // And a later yes has nothing to say yes to: it is an ordinary message again.
    const m = scripted([{ text: 'Yes to what? Tell me what to change.' }]);
    const later = await say((await getSession(session.id))!, 'yes', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(1);
    expect(later.resultMeta).toMatchObject({ by: 'agent' });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
  });

  it('a yes after the search changed under the question is not applied, and says why', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'the weekend after maybe', deps(supplier.supplier, scripted(ASK).callModel));
    // A chip edit in between (not a chat turn): three adults now.
    const { dispatchActions } = await import('@/server/dispatch');
    await dispatchActions({ session: (await getSession(session.id))!, stay: await stayOf(session.id), actions: [{ type: 'set_guests', adults: 3, childrenAges: [], rooms: 1 }], supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    const yes = await say((await getSession(session.id))!, 'yes', noJev(supplier.supplier, NEVER));
    expect(yes.finalText).toBe('The search has changed since I asked, so I have not applied that. Say what you want and I will do it.');
    expect(yes.resultMeta).toMatchObject({ by: 'staged', stage: 'search_changed' });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11', adults: 3 });
  });

  it('a yes long after the question is not applied', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'the weekend after maybe', deps(supplier.supplier, scripted(ASK).callModel));
    const late = { ...noJev(supplier.supplier, NEVER), now: () => new Date(RECORDED_AT.getTime() + 16 * 60 * 1000) };
    const yes = await say((await getSession(session.id))!, 'ok', late);
    expect(yes.resultMeta).toMatchObject({ by: 'staged', stage: 'too_old' });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
  });

  it('"yes but under 100" is a new request, not a yes: the normal path, and the stage is gone', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'the weekend after maybe', deps(supplier.supplier, scripted(ASK).callModel));
    const m = scripted([{ tool: 'set_price_cap', input: { per_night: 100 } }]);
    const turn = await say((await getSession(session.id))!, 'yes but under 100', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(1);
    expect(turn.resultMeta).toMatchObject({ by: 'agent' });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11', priceCapMinor: 10000 }); // the dates were NOT applied
    const yes = await say((await getSession(session.id))!, 'yes', deps(supplier.supplier, scripted([{ text: 'Tell me what to change.' }]).callModel));
    expect(yes.resultMeta).toMatchObject({ by: 'agent' });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
  });

  it('a question that fails the reply guards is replaced by the fixed one; the stage still stands', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'That would be 9999 euros, shall I?' }, { tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }, { tool: 'hold_for_confirmation', input: {} }]);
    const turn = await say(session, 'the weekend after maybe', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toBe('Shall I go ahead with that?');
    expect((await last(session.id)).kind).toBe('line');
    expect(turn.resultMeta).toMatchObject({ staged: 1, guards: ['ungrounded_number'] });
  });

  it('hold_for_confirmation with nothing queued holds nothing: the question is just a question', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'Which weekend do you mean?' }, { tool: 'hold_for_confirmation', input: {} }]);
    const turn = await say(session, 'another weekend', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toBe('Which weekend do you mean?');
    expect(turn.resultMeta).not.toHaveProperty('stagedPlan');
  });
});

describe('a request the app cannot serve yet', () => {
  it('is stored for the builders, with the session it came from, and answered with the fixed line', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'I will let them know!' }, { tool: 'submit_idea', input: { request: 'book a flight to Porto with the hotel' } }]);
    const turn = await say(session, 'can you book my flight too?', deps(supplier.supplier, m.callModel));
    expect(m.calls).toHaveLength(1);
    expect(turn.finalText).toBe('I cannot do that yet. I have passed it on to the people who build this.');
    expect((await last(session.id)).kind).toBe('line'); // the server's words, not the model's
    expect(await rawQuery('select text, session_id from ideas')).toEqual([{ text: 'book a flight to Porto with the hotel', session_id: session.id }]);
  });

  it('an empty or essay-length request is refused back to the model and nothing is stored', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'submit_idea', input: { request: 'x'.repeat(201) } }], [{ text: 'I only search hotels.' }]);
    await say(session, 'do my taxes', deps(supplier.supplier, m.callModel));
    expect(await rawQuery('select 1 from ideas')).toHaveLength(0);
  });
});

describe('the turn stops itself before the platform does (lib/turnBudget.ts)', () => {
  /** A clock the test moves: each model call "takes" this long. */
  const timed = (m: ReturnType<typeof scripted>, perCallMs: number) => {
    let t = 1_000_000;
    const callModel: CallModel = async (call) => {
      const reply = await m.callModel(call);
      t += perCallMs;
      return reply;
    };
    return { callModel, clock: () => t, deadline: 1_000_000 + 280_000 };
  };

  it('no room for another model call: it is not made, and what was queued is not applied', async () => {
    const { session, supplier } = await onboarded();
    const before = await stayOf(session.id);
    // The first call looks a place up AND queues new dates; it takes 250 s, so a second call cannot fit.
    const m = scripted([{ tool: 'resolve_place', input: { query: 'Lisbon' } }, { tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }]);
    const t = timed(m, 250_000);
    const turn = await say(session, 'lisbon the weekend after', { ...deps(supplier.supplier, t.callModel), clock: t.clock, deadline: t.deadline });
    expect(m.calls).toHaveLength(1);
    expect(turn.status).toBe('done');
    expect(turn.finalText).toBe('That took too long, so I stopped before changing anything. Send it again.');
    expect(turn.resultMeta).toMatchObject({ timed_out: 'model', dropped_actions: 1, model_calls: 1 });
    expect(await stayOf(session.id)).toMatchObject({ checkIn: before.checkIn, checkOut: before.checkOut });
    // The call that was made is still on the ledger: time ran out, the money was still spent.
    expect(await rawQuery("select 1 from usage_events where provider = 'anthropic'")).toHaveLength(1);
  });

  it('room for the model but not for the search that would follow: the change is dropped, and said so', async () => {
    const { session, supplier } = await onboarded();
    const searches = supplier.searches.length;
    const m = scripted([{ tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }]);
    const t = timed(m, 230_000); // 50 s left: under the 60 s a re-search may take
    const turn = await say(session, 'the weekend after', { ...deps(supplier.supplier, t.callModel), clock: t.clock, deadline: t.deadline });
    expect(turn.finalText).toBe('That took too long, so I stopped before changing anything. Send it again.');
    expect(turn.resultMeta).toMatchObject({ timed_out: 'dispatch', dropped_actions: 1 });
    expect(supplier.searches).toHaveLength(searches);
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-11' });
  });

  it('with time in hand nothing changes: the same turn applies', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }]);
    const t = timed(m, 3_000);
    const turn = await say(session, 'the weekend after', { ...deps(supplier.supplier, t.callModel), clock: t.clock, deadline: t.deadline });
    expect(turn.finalText).toBe('18–20 Dec, 2 nights.');
  });
});

describe('the agent: what the router did not settle', () => {
  it('the map through the agent: one call, the fixed line, and the screen told what to do', async () => {
    const { session, supplier } = await onboarded();
    const before = await names(session.id);
    const hide = scripted([{ tool: 'show_map', input: { visible: false } }]);
    const turn = await say(session, 'the map is in my way', deps(supplier.supplier, hide.callModel));
    expect(hide.calls).toHaveLength(1);
    expect(turn.finalText).toBe('The map is folded away. Say "show the map" to bring it back.');
    expect((await last(session.id)).meta).toEqual({ ui: { map: 'hide' } });
    expect((await last(session.id)).kind).toBe('line');

    const mark = scripted([{ tool: 'mark_on_map', input: { position: 2 } }]);
    const marked = await say((await getSession(session.id))!, 'point out the second on the map', deps(supplier.supplier, mark.callModel));
    expect(marked.finalText).toBe(`${before[1]} is marked on the map.`);
    expect((await last(session.id)).meta).toMatchObject({ ui: { focus: { propertyId: expect.any(String) } } });
    expect(await names(session.id)).toEqual(before);
  });

  it('the full list through the agent: one call, the line counted from the rows, nothing set aside', async () => {
    const { session, supplier } = await onboarded();
    const before = await names(session.id);
    const all = scripted([{ tool: 'show_all_hotels', input: {} }]);
    const turn = await say(session, 'can you just list everything you found', deps(supplier.supplier, all.callModel));
    expect(all.calls).toHaveLength(1);
    expect(turn.finalText).toBe('All 20 hotels that fit are listed under the top picks, in the same order.');
    expect((await last(session.id)).meta).toEqual({ ui: { all: 'show' } });
    expect((await last(session.id)).kind).toBe('line');
    expect(await names(session.id)).toEqual(before);
    expect((await stayOf(session.id)).excludedPropertyIds).toEqual([]);

    // With a change in the same reply: the change is applied and reported, and the list still opens.
    const both = scripted([{ tool: 'require', input: { must_have: 'pets_allowed' } }, { tool: 'show_all_hotels', input: {} }]);
    await say((await getSession(session.id))!, 'only ones that take dogs, and show me all of them', deps(supplier.supplier, both.callModel));
    expect((await stayOf(session.id)).mustHaves).toEqual(['pets_allowed']);
    expect((await last(session.id)).meta).toEqual({ ui: { all: 'show' } });
  });

  it('"save the second one": saved through the heart\'s path, the server\'s line, and the saved list told to show; "show my saved" lists names only', async () => {
    const { session, supplier } = await onboarded();
    const before = await names(session.id);
    const none = scripted([{ tool: 'show_saved', input: {} }]);
    expect((await say(session, 'what did I save?', deps(supplier.supplier, none.callModel))).finalText).toBe('You have not saved any hotels yet. Press the heart on one to keep it.');

    const save = scripted([{ text: 'Saved it for you!' }, { tool: 'save_hotel', input: { position: 2 } }]);
    const turn = await say((await getSession(session.id))!, 'save the second one', deps(supplier.supplier, save.callModel));
    expect(save.calls).toHaveLength(1);
    expect(turn.finalText).toBe(`${before[1]} is saved. Your saved hotels are listed beside your trips.`);
    expect((await last(session.id)).kind).toBe('line'); // not the model's words
    expect((await last(session.id)).meta).toEqual({ ui: { saved: 'show' } });
    expect(await rawQuery<{ anon_id: string; session_id: string }>('select anon_id, session_id from saved_hotels')).toEqual([{ anon_id: 'anon-1', session_id: session.id }]);
    expect(await names(session.id)).toEqual(before); // the search is untouched
    expect(supplier.searches).toHaveLength(1);

    const list = scripted([{ tool: 'show_saved', input: {} }]);
    const listed = await say((await getSession(session.id))!, 'show my saved hotels', deps(supplier.supplier, list.callModel));
    expect(listed.finalText).toBe(`You have saved one hotel: ${before[1]}. They are listed beside your trips.`);
    expect(listed.finalText).not.toMatch(/€|\d{2,}/); // no price in the chat line

    // A position that is not on screen saves nothing; the model is told, and may answer.
    const wrong = scripted([{ tool: 'save_hotel', input: { position: 9 } }], [{ text: 'There is no ninth hotel on screen.' }]);
    await say((await getSession(session.id))!, 'save the ninth', deps(supplier.supplier, wrong.callModel));
    expect(await rawQuery('select 1 from saved_hotels')).toHaveLength(1);
  });

  it('new dates in prose become one typed action; the reply is the server\'s, and the call is on the ledger', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([{ text: 'Sure, I have changed your dates!' }, { tool: 'set_dates', input: { check_in: '2026-12-18', check_out: '2026-12-20' } }]);
    const turn = await say(session, 'actually make it the weekend after', deps(supplier.supplier, m.callModel));

    expect(m.calls).toHaveLength(1); // only changes were asked for: no second call to write a reply
    expect(await stayOf(session.id)).toMatchObject({ checkIn: '2026-12-18', checkOut: '2026-12-20' });
    expect(supplier.searches).toHaveLength(2); // the dates changed, so rates were fetched again
    expect(turn.finalText).toBe('18–20 Dec, 2 nights.');
    expect((await last(session.id)).kind).toBe('line'); // not the model's words
    expect(turn.resultMeta).toMatchObject({ by: 'agent', deferred: 'no_reading', model_calls: 1, applied: 1, effect: 'refetch' });
    expect(await rawQuery("select model, input_tokens, output_tokens, cost_microcents::int as cost, success, meta from usage_events where provider = 'anthropic'")).toEqual([
      { model: MODEL, input_tokens: 1200, output_tokens: 60, cost: 150000, success: true, meta: { purpose: 'agent', stop_reason: 'end_turn' } },
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

  it('a place inside the town being searched is somewhere to be close to, never a new trip, and closeness joins what "best" means', async () => {
    // Sam, 11 Nov 2026: "i wanna stay on east manor" made Manor Road the destination and kept ranking by price only.
    const { session, supplier } = await onboarded();
    const m = scripted([{ tool: 'resolve_place', input: { query: 'Ribeira, Porto' } }], [{ tool: 'set_destination', input: { place_ref: 'P1' } }]);
    const turn = await say(session, 'actually search the Ribeira instead', deps(supplier.supplier, m.callModel));

    expect(supplier.placeQueries).toEqual(['Ribeira, Porto']);
    expect(await stayOf(session.id)).toMatchObject({ destinationText: 'Porto, Portugal', nearPlaceId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo' });
    expect(await getSession(session.id)).toMatchObject({ priorities: ['cheapest', 'closest'] });
    expect(m.sent()).toContain('P1: Ribeira, Porto, Portugal');
    expect(m.sent()).not.toContain('ChIJicetJOdkJA0R8GJ9Dy_dcgo');
    expect(turn.resultMeta).toMatchObject({ actions: [{ type: 'set_near' }, { type: 'set_priorities', priorities: ['cheapest', 'closest'] }] });
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
    expect(turn.finalText).toBe('Set aside.');
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

  it('the agent reads pets and cancellation off the rows, so a listing it cannot fetch costs it nothing it needs (2026-11-14)', async () => {
    const over: Parameters<typeof recordedSupplier>[0] = {};
    const supplier = recordedSupplier(over);
    const session = await createSession({ anonId: 'pet' });
    let guestsAnswered = false;
    for (const answer of ANSWERS.map((a) => (a.field === 'guests' ? { ...a, pets: true } : a))) {
      await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    over.content = 'fail';
    // The second hotel's rate carries no cancellation tag: silent, not non-refundable.
    await rawQuery("update offers set refundable_tag = null where property_id = (select id from properties where name = 'ICON Duplo Ribeira')");
    const m = scripted([{ tool: 'hotel_details', input: { position: 1 } }], [{ text: 'It lists pets as allowed, and the rate is non-refundable.' }]);
    const turn = await say((await getSession(session.id))!, 'does the first one take my dog, and is it refundable? also is it quiet', deps(supplier.supplier, m.callModel));
    const first = JSON.stringify(m.calls[0].messages[0].content);
    const line = (name: string) => first.split('\\n').find((l) => l.includes(name))!;
    expect(line('Mercure Porto Centro Aliados')).toContain('non-refundable');
    expect(line('Mercure Porto Centro Aliados')).toMatch(/facilities its listing names \(anything else is not listed, which is not a no\): [^;]*pets allowed/);
    expect(line('ICON Duplo Ribeira')).toContain('cancellation: the listing does not say');
    expect(line('ICON Duplo Ribeira')).not.toContain('non-refundable');
    // The failed fetch points the model back at those rows.
    expect(JSON.stringify(m.calls[1].messages.at(-1)!.content)).toContain('Answer from its line in <hotels_on_screen>');
    expect(turn.finalText).toBe('It lists pets as allowed, and the rate is non-refundable.');
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
    expect(await stayOf(sessionId)).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2, rooms: null, priceCapMinor: 12000, mustHaves: ['pets_allowed'], placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo' });
    const rows = (await listMessages(sessionId)).slice(-3).map((r) => [r.kind, r.content]);
    expect(rows).toEqual([
      ['form_answer', 'Ribeira, Porto, Portugal'],
      ['line', 'From your message: 11–13 Dec, 2 nights · 2 adults · up to €120 a night · pets allowed.'],
      ['form_question', 'What matters most? Pick any, or say it in your own words.'],
    ]);
    expect(await rawQuery("select meta from usage_events where provider = 'anthropic'")).toEqual([{ meta: { purpose: 'scan', stop_reason: 'end_turn' } }]);
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

  it('a second message adds to what the first said: a typed place with a party keeps the dates and the dog', async () => {
    const supplier = recordedSupplier();
    const session = await createSession({ anonId: 'a' });
    await askQuestion(session.id, 'destination');
    await say(session, 'a week from next Monday with my dog', deps(supplier.supplier, scan({ check_in: '2026-11-16', nights: 7, must_haves: ['pets_allowed'] }).callModel));
    await say((await getSession(session.id))!, 'porto, two of us', deps(supplier.supplier, scan({ destination: 'Porto', adults: 2 }).callModel));
    const draft = (await getSession(session.id))!.draft;
    expect(draft.scanned).toMatchObject({ checkIn: '2026-11-16', checkOut: '2026-11-23', mustHaves: ['pets_allowed'], guests: { adults: 2 } });
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

describe('"what matters most?" answered in words', () => {
  /** Destination, dates and guests answered: the priorities card is open. */
  async function atPriorities(placesFor?: (q: string) => string) {
    const supplier = recordedSupplier({}, placesFor);
    const session = await createSession({ anonId: 'w' });
    await askQuestion(session.id, 'destination');
    let guestsAnswered = false;
    for (const answer of ANSWERS.slice(0, 3)) {
      expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    expect((await listMessages(session.id)).at(-1)).toMatchObject({ meta: { field: 'priorities' } });
    return { session: (await getSession(session.id))!, supplier };
  }
  const jevReads = (wants: [number, number, number, number]): JevOutcome => ({
    ...JEV_DOWN,
    failure: null,
    readings: {
      tier: { choice: 'T1', top: 1, margin: 1 }, intent: { choice: 'priority', top: 0.9, margin: 0.8 }, multiIntent: 0.05, amenity: { choice: 'none', top: 1, margin: 1 }, removing: 0.05,
      wantsPrice: wants[0], wantsQuality: wants[1], wantsLocation: wants[2], namesPlace: wants[3], fact: null, superlative: null, searchField: null,
    },
  });

  it('Jev settles the set: no model call, the search runs, and the chat says how it was read', async () => {
    const { session, supplier } = await atPriorities();
    const m = scripted();
    await say(session, 'nice but not crazy expensive', { ...deps(supplier.supplier, m.callModel), askJev: async () => jevReads([0.9, 0.92, 0.1, 0.02]) });
    expect(m.calls).toHaveLength(0);
    expect(await getSession(session.id)).toMatchObject({ status: 'active', priorities: ['cheapest', 'nicest'] });
    const rows = (await listMessages(session.id)).map((r) => [r.kind, r.content]);
    expect(rows).toContainEqual(['line', 'Ranked for low price and great reviews.']);
    // The typed words are the user's bubble; no second, form-style echo.
    expect(rows.filter(([k]) => k === 'form_answer')).toHaveLength(3);
    expect(supplier.searches).toHaveLength(1);
  });

  it('Jev unsure: one forced Haiku call; a named place is looked up in this town, and the search is around it', async () => {
    const { session, supplier } = await atPriorities();
    const m = scripted([{ tool: 'record_priorities', input: { priorities: ['cheapest'], near_place: 'Ribeira', near_place_local: 'Ribeira', no_preference: false } }]);
    await say(session, 'cheap, near the river by Ribeira', { ...deps(supplier.supplier, m.callModel), askJev: async () => jevReads([0.9, 0.3, 0.95, 0.95]) });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].forceTool).toBe('record_priorities');
    expect(supplier.placeQueries.at(-1)).toBe('Ribeira, Porto'); // local name first; the same here
    expect(await getSession(session.id)).toMatchObject({ status: 'active', priorities: ['cheapest', 'closest'] });
    const [stay] = await listStays(session.id);
    expect(stay).toMatchObject({ nearPlaceId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo', nearLabel: 'Ribeira' });
    expect(supplier.searches[0].where).toMatchObject({ radiusM: 5000 });
    expect((await listMessages(session.id)).map((r) => r.content)).toContain('Ranked for low price and being close to Ribeira.');
    expect(await rawQuery("select meta from usage_events where provider = 'anthropic'")).toEqual([{ meta: { purpose: 'priorities', stop_reason: 'end_turn' } }]);
  });

  it('a place search that finds only hotels is not a place to be near: the search runs, and says so', async () => {
    // Recorded: "old town, Annecy" returns one hotel and nothing else.
    const { session, supplier } = await atPriorities(() => 'places-old-town-annecy');
    const m = scripted([{ tool: 'record_priorities', input: { priorities: ['closest'], near_place: 'old town', near_place_local: null, no_preference: false } }]);
    await say(session, 'close to the old town', deps(supplier.supplier, m.callModel));
    expect(await getSession(session.id)).toMatchObject({ status: 'active', priorities: ['closest'] });
    expect((await listStays(session.id))[0]).toMatchObject({ nearPlaceId: null });
    expect(supplier.placeLookups).not.toContain(expect.stringMatching(/old/i));
    expect((await listMessages(session.id)).map((r) => r.content)).toContain('Ranked for being close to central Porto. "old town" was not found in Porto, so close means central Porto.');
  });

  it('words that say nothing about it keep the question open', async () => {
    const { session, supplier } = await atPriorities();
    const m = scripted([{ tool: 'record_priorities', input: { priorities: [], near_place: null, near_place_local: null, no_preference: false } }]);
    const turn = await say(session, 'hmm', deps(supplier.supplier, m.callModel));
    expect(turn.finalText).toMatch(/did not say what matters/);
    expect(await getSession(session.id)).toMatchObject({ status: 'onboarding', priorities: null });
    expect(supplier.searches).toHaveLength(0);
  });

  it('"anything is fine" is an answer: a balanced search', async () => {
    const { session, supplier } = await atPriorities();
    const m = scripted([{ tool: 'record_priorities', input: { priorities: [], near_place: null, near_place_local: null, no_preference: true } }]);
    await say(session, 'anything is fine honestly', deps(supplier.supplier, m.callModel));
    expect(await getSession(session.id)).toMatchObject({ status: 'active', priorities: [] });
    expect((await listMessages(session.id)).map((r) => r.content)).toContain('No preference: a balanced search.');
  });
});

describe('the first screen: one box, three pills', () => {
  const scanOf = (input: Record<string, unknown>) =>
    scripted([{ tool: 'record_trip', input: { destination: null, check_in: null, check_out: null, nights: null, adults: null, children_ages: null, rooms: null, max_per_night: null, must_haves: [], priorities: [], ...input } }]);
  const brief = (over: Partial<Brief>): Brief => briefSchema.parse(over);
  async function submit(b: Brief, model = scripted(), placesFor?: (q: string) => string) {
    const supplier = recordedSupplier({}, placesFor);
    const session = await createSession({ anonId: 'box' });
    const r = await startFromBrief({ session, brief: b, supplier: supplier.supplier, callModel: model.callModel, model: MODEL, now: RECORDED_AT, today: TODAY });
    return { r, supplier, model, sessionId: session.id };
  }

  it('a picked place and nothing else: no model call, tonight for 2 adults, balanced, and straight to results', async () => {
    const { r, supplier, model, sessionId } = await submit(brief({ place: { placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' } }));
    expect(r).toEqual({ ok: true });
    expect(model.calls).toHaveLength(0);
    expect(await getSession(sessionId)).toMatchObject({ status: 'active', priorities: [] });
    // Rooms not said: null, the finder's to choose (a couple: one room, one search).
    expect(await stayOf(sessionId)).toMatchObject({ checkIn: '2026-11-11', checkOut: '2026-11-12', adults: 2, rooms: null });
    expect(supplier.searches).toHaveLength(1);
    // One bubble, the user's: no form-style echo of the place, no "From your message" line.
    expect((await listMessages(sessionId)).map((x) => [x.role, x.kind, x.content])).toEqual([
      ['user', 'user', 'Porto, Portugal'],
      ['assistant', 'line', expect.stringMatching(/^\d+ of \d+ hotels fit\./)],
      // A lot fit, so Penny names one: her own pick (no hotel is sponsored), with real numbers.
      ['assistant', 'line', '20 hotels fit, so here is a nudge: I like Mercure Porto Centro Aliados, rated 9.2, the cheapest of the top three. Which of these appeals to you?'],
    ]);
  });

  it('a sentence: read once, the place picked without asking, its words used, tonight by default', async () => {
    const m = scanOf({ destination: 'Annecy, France', adults: 1, priorities: ['nicest', 'closest'] });
    const { supplier, sessionId } = await submit(brief({ text: 'Annecy, just me, central and well rated' }), m, () => 'places-annecy');
    expect(m.calls).toHaveLength(1);
    expect(supplier.placeQueries).toEqual(['Annecy, France']);
    expect(await getSession(sessionId)).toMatchObject({ status: 'active', priorities: ['nicest', 'closest'] });
    expect(await stayOf(sessionId)).toMatchObject({ destinationText: 'Annecy, France', checkIn: '2026-11-11', checkOut: '2026-11-12', adults: 1, destKind: 'area' });
    // The app picked the place, so Penny says so and invites a correction (Sam's decision, 2026-11-13).
    expect((await listMessages(sessionId)).map((x) => x.content)).toContain(
      'Searching Annecy, France. Not where you meant? Tell me where you want to stay and I will search there instead.',
    );
  });

  it('a start day with no length, and a place to pick: the nights card opens on that day, not tonight', async () => {
    // Sam, 2026-11-13: "Annex for a week with dogs let's say next week Monday" lost its dates on the place question.
    const m = scanOf({ destination: 'Lisbon', check_in: '2026-11-16', must_haves: ['pets_allowed'] });
    const { sessionId, supplier } = await submit(brief({ text: 'Lisbon from next Monday with my dog' }), m, () => 'places-lisbon');
    expect((await listMessages(sessionId)).at(-1)).toMatchObject({ kind: 'form_question', meta: { field: 'destination' } });
    // Picked through the form route, which passes no words: the read-back must still be the words only.
    await answerForm({ sessionId, answer: { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Lisbon, Portugal' }, guestsAnswered: false, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    const rows = await listMessages(sessionId);
    const line = rows.find((r) => r.content.startsWith('From your message'))!;
    expect(line.content).toBe('From your message: nights from Mon 16 Nov · pets allowed.');
    expect(line.content).not.toMatch(/2 adults/); // the default was never in the words
    expect(rows.at(-1)).toMatchObject({ kind: 'form_question', meta: { field: 'dates', checkIn: '2026-11-16', prompt: 'Which nights from Mon 16 Nov? Tap the last night.' } });
  });

  it('four towns called Lisbon, and "3 nights in March": asks which, then the nights; never tonight', async () => {
    const m = scanOf({ destination: 'Lisbon', adults: 2, nights: 3, month: '2027-03', must_haves: ['pets_allowed'], priorities: ['nicest', 'cheapest'] });
    const { sessionId, supplier } = await submit(brief({ text: 'Lisbon with my wife and the dog, 3 nights in March, nice but not crazy expensive' }), m, () => 'places-lisbon');
    const q = (await listMessages(sessionId)).at(-1)!;
    expect(q).toMatchObject({ kind: 'form_question', meta: { field: 'destination', prompt: 'Which Lisbon?' } });
    expect((q.meta as { suggestions: unknown[] }).suggestions).toHaveLength(4);
    expect((await getSession(sessionId))!.draft.scanned).toMatchObject({ guests: { adults: 2 }, mustHaves: ['pets_allowed'] });
    expect((await getSession(sessionId))!.draft.scanned?.checkIn).toBeUndefined();
    // Picking Lisbon, Portugal (recorded details are Porto's: any recorded id will do for the step).
    await answerForm({ sessionId, answer: { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Lisbon, Portugal' }, guestsAnswered: false, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    expect((await listMessages(sessionId)).map((x) => x.content)).toContainEqual(expect.stringMatching(/^From your message: 3 nights in March · 2 adults · pets allowed/i));
    // The nights card opens on March with a 3-night stay, and says so.
    expect((await listMessages(sessionId)).at(-1)).toMatchObject({
      kind: 'form_question',
      meta: { field: 'dates', nights: 3, month: '2027-03', prompt: 'Which 3 nights in March? Tap the first night.' },
    });
    expect(supplier.searches).toHaveLength(0);
    // The results side shows what is known so far, not an empty panel.
    expect((await buildSessionView((await getSession(sessionId))!)).pending).toMatchObject({
      destination: 'Lisbon, Portugal',
      guests: { adults: 2 },
      priorities: ['cheapest', 'nicest'],
    });

    // Typed instead of tapped: words that give no date keep the card open, and nothing is stored.
    const vague = scanOf({});
    await say((await getSession(sessionId))!, 'whenever really', deps(supplier.supplier, vague.callModel));
    expect(await stayOf(sessionId)).toBeUndefined();
    expect((await last(sessionId)).content).toMatch(/^That did not give two dates/);

    // "the second weekend" is read with the card's hint, and the server's dates check still applies.
    const typed = scanOf({ check_in: '2027-03-12', nights: 3 });
    await say((await getSession(sessionId))!, 'the second weekend', deps(supplier.supplier, typed.callModel));
    expect(typed.sent()).toContain('the trip is 3 nights in 2027-03');
    expect(await stayOf(sessionId)).toMatchObject({ checkIn: '2027-03-12', checkOut: '2027-03-15' });
    expect((await listMessages(sessionId)).map((x) => x.content)).toContain('Reading that as 12–15 Mar, 3 nights.');
  });

  it('a pill the user set wins over the words', async () => {
    const m = scanOf({ destination: 'Porto', check_in: '2026-11-13', check_out: '2026-11-15', adults: 4 });
    const { sessionId } = await submit(
      brief({ text: 'Porto next weekend for four', dates: { checkIn: '2026-12-11', checkOut: '2026-12-13' }, guests: { adults: 2, childrenAges: [], rooms: 1, pets: false }, priorities: ['cheapest'] }),
      m,
      () => 'places-porto',
    );
    expect(await stayOf(sessionId)).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2 });
    expect(await getSession(sessionId)).toMatchObject({ priorities: ['cheapest'] });
  });

  it('refused before anything is stored: nothing typed or picked, dates in the past, more rooms than adults', () => {
    expect(checkBrief(brief({}), TODAY)).toBe('empty_brief');
    expect(checkBrief(brief({ text: '  ' }), TODAY)).toBe('empty_brief');
    expect(checkBrief(brief({ text: 'Porto', dates: { checkIn: '2026-11-01', checkOut: '2026-11-02' } }), TODAY)).toBe('dates_in_past');
    expect(checkBrief(brief({ text: 'Porto', guests: { adults: 1, childrenAges: [], rooms: 2, pets: false } }), TODAY)).toBe('more_rooms_than_adults');
    expect(briefSchema.safeParse({ text: 'x', priorities: ['basic'] }).success).toBe(false);
    expect(briefSchema.safeParse({ text: 'x', placeId: 'injected' }).success).toBe(false);
  });

  it('the place search down: the user is asked to type it again, nothing searched', async () => {
    const supplier = recordedSupplier({ places: 'fail' });
    const session = await createSession({ anonId: 'down' });
    const m = scanOf({ destination: 'Porto' });
    expect(await startFromBrief({ session, brief: brief({ text: 'Porto' }), supplier: supplier.supplier, callModel: m.callModel, model: MODEL, now: RECORDED_AT, today: TODAY })).toEqual({ ok: true });
    const rows = await listMessages(session.id);
    expect(rows.at(-2)).toMatchObject({ kind: 'line', content: 'The place search did not answer. Type the place again.' });
    expect(rows.at(-1)).toMatchObject({ kind: 'form_question', meta: { field: 'destination' } });
  });
});

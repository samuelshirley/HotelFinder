import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb } from './harness';
import { recordedSupplier, RECORDED_AT } from './recordedSupplier';
import { haversineKm } from '@/lib/finder/geo';
import type { Locale } from '@/lib/i18n/locale';
import type { Readings } from '@/lib/router/route';
import { expiredSightsLine, pickSights, parsePlaces, sightsCentre } from '@/lib/sights';
import type { CallModel } from '@/server/agent';
import { dispatchActions } from '@/server/dispatch';
import type { JevOutcome } from '@/server/jev';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, listStays, purgeExpiredSights } from '@/server/repos/sessions';
import { getSightsFinder, type FindSights } from '@/server/sights';
import { fixture, replay } from '@/server/sights/fixtures';
import { runTurn, type TurnDeps } from '@/server/turn';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const TODAY = '2026-11-11';
const MODEL = 'claude-haiku-4-5-20251001' as const;
const PORTO = { latitude: 41.1579438, longitude: -8.629105299999999 };
const sure = <L extends string>(choice: L) => ({ choice, top: 0.97, margin: 0.9 });
const NO_MODEL: CallModel = async (call) => ({ ok: false, model: call.model, failure: 'not_configured', latencyMs: 0, errorMessage: 'ANTHROPIC_API_KEY is not set' });
const JEV_DOWN: JevOutcome = { readings: null, failure: 'timeout', latencyMs: 800, model: null, inputTokens: 0, outputTokens: 0, settleMin: 0.85, errorMessage: 'timed out' };

function jevSays(over: Partial<Readings>): JevOutcome {
  return {
    readings: { tier: sure('T1'), intent: sure('sights'), multiIntent: 0.02, amenity: sure('none'), removing: 0.03, wantsPrice: 0.02, wantsQuality: 0.02, wantsLocation: 0.02, namesPlace: 0.02, fact: sure('none'), superlative: sure('none'), searchField: sure('none'), ...over },
    failure: null,
    latencyMs: 140,
    model: 'jev-1.14.0',
    inputTokens: 520,
    outputTokens: 40,
    settleMin: 0.85,
    errorMessage: null,
  };
}

/** The real finder over a recorded Google response: the call is metered into the test database like a live one. */
const recordedSights = (sessionId: string, name = 'nearby-museums-porto', language?: string) => {
  const r = replay(name);
  return { find: getSightsFinder({ apiKey: 'test-key-never-real', sessionId, language, fetchImpl: r.fetchImpl }), calls: r.calls };
};

function deps(supplier: TurnDeps['supplier'], findSights: FindSights, over: Partial<TurnDeps> = {}): TurnDeps {
  return { supplier, findSights, askJev: async () => jevSays({ sightKind: sure('museums') }), jevCost: () => 2184, callModel: NO_MODEL, model: MODEL, now: () => RECORDED_AT, today: TODAY, ...over };
}

/** A model that answers from a script of tool calls. */
function scripted(...steps: Array<Array<{ tool: string; input: unknown }>>) {
  let n = 0;
  const callModel: CallModel = async (call) => {
    const step = steps[n++];
    if (!step) throw new Error('the model was called more often than scripted');
    return { ok: true, model: call.model, stopReason: 'end_turn', latencyMs: 700, usage: { input: 1200, cacheWrite: 0, cacheRead: 0, output: 60 }, content: step.map((b, i) => ({ type: 'tool_use' as const, id: `tu_${n}_${i}`, name: b.tool, input: b.input })) };
  };
  return { callModel, calls: () => n };
}

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
const say = (session: NonNullable<Awaited<ReturnType<typeof getSession>>>, message: string, d: TurnDeps) => runTurn({ session, message, idempotencyKey: crypto.randomUUID(), deps: d, emit: () => {} });
const stayOf = async (sessionId: string) => (await listStays(sessionId))[0];
const fresh = async (id: string) => (await getSession(id))!;

/** What the recording says the most popular Porto museums are, worked out from Google's rows. */
const POPULAR = pickSights(parsePlaces(fixture('nearby-museums-porto'), 'museums'), PORTO);

describe('"I want to tour some museums": settled by the router, looked up in code', () => {
  it('stores Google\'s most popular museums, ranks close to the middle of them, and says which they are', async () => {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id);
    const turn = await say(session, 'I want to tour some museums', deps(supplier.supplier, sights.find));

    expect(turn.status).toBe('done');
    // Two nights have time for four: the four most reviewed, named in the line exactly as Google names them.
    const four = POPULAR.slice(0, 4).map((p) => p.name);
    expect(four).toEqual(['FC Porto Museum', 'World of Discoveries', 'Serralves Museum of Contemporary Art', 'Soares dos Reis']);
    expect(turn.finalText).toBe(
      `The most popular museums in Porto, by Google reviews: ${four[0]}, ${four[1]}, ${four[2]} and ${four[3]}. A plan for each day is above the hotels. Ranked for low price and being close to the museums.`,
    );
    expect(turn.resultMeta).toMatchObject({ by: 'router', intent: 'sights', model_calls: 0, applied: 2, effect: 'refetch', actions: [{ type: 'set_sights', kind: 'museums' }] });

    // The stay holds the eight most popular; "close" is the middle of the four in play.
    const stay = await stayOf(session.id);
    // Stamped when Google answered: the purge removes them 30 days later (Google's terms).
    expect(stay.sights).toEqual({ kind: 'museums', places: POPULAR, fetchedAt: RECORDED_AT.toISOString() });
    const centre = sightsCentre({ kind: 'museums', places: POPULAR }, 2)!;
    expect(stay).toMatchObject({ nearPlaceId: 'sights:museums', nearLabel: 'the museums', latitude: centre.latitude, longitude: centre.longitude });
    expect((await fresh(session.id)).priorities).toEqual(['cheapest', 'closest']);

    // Google was asked once, around the destination's own point, and the search then ran around the museums.
    expect(sights.calls).toHaveLength(1);
    expect(JSON.parse(sights.calls[0].init.body as string).locationRestriction.circle.center).toEqual(PORTO);
    expect(supplier.searches).toHaveLength(2);
    expect(supplier.searches[1].where).toMatchObject({ latitude: centre.latitude, longitude: centre.longitude });
    // The sights' stand-in id is never looked up at the supplier.
    expect(supplier.placeLookups.some((id) => id.startsWith('sights:'))).toBe(false);

    // One Google row on the ledger, at the list price, tied to this search; it is not AI spend.
    expect(await rawQuery("select provider, cost_microcents::int as cost, success, session_id, meta from usage_events where provider like 'google%'")).toEqual([
      { provider: 'google:places', cost: 3_500_000, success: true, session_id: session.id, meta: { op: 'nearby', sku: 'nearby_search_enterprise', kind: 'museums', found: 20 } },
    ]);
  });

  it('the view carries the sights in play and where "close" is, in the user\'s language', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'I want to tour some museums', deps(supplier.supplier, recordedSights(session.id).find));
    const view = await buildSessionView(await fresh(session.id), 'en', RECORDED_AT);
    expect(view.stay!.sights).toEqual({ kind: 'museums', places: POPULAR.slice(0, 4) });
    expect(view.stay).toMatchObject({ nearLabel: 'the museums', nearIsNamed: true, anchor: { label: 'the museums' } });
    // Every hotel listed says how far it is from the museums' middle, by the same geometry.
    const centre = sightsCentre({ kind: 'museums', places: POPULAR }, 2)!;
    for (const row of view.shortlist.filter((r) => r.property.latitude !== null)) {
      const km = haversineKm(centre, { latitude: row.property.latitude!, longitude: row.property.longitude! });
      expect((row.reason as unknown as { distance_km: number }).distance_km).toBeCloseTo(km, 0);
    }
    const es = await buildSessionView(await fresh(session.id), 'es', RECORDED_AT);
    expect(es.stay).toMatchObject({ nearLabel: 'los museos', anchor: { label: 'los museos' } });
    // Nothing internal: no key, no SKU, no raw Google payload.
    expect(JSON.stringify(view)).not.toMatch(/test-key|nearby_search|userRatingCount/);
  });

  it('in Spanish: Google is asked in Spanish and the line is Spanish', async () => {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id, 'nearby-museums-porto-es', 'es');
    const turn = await say(session, 'quiero visitar museos', deps(supplier.supplier, sights.find, { locale: 'es' as Locale }));
    expect(JSON.parse(sights.calls[0].init.body as string).languageCode).toBe('es');
    expect(turn.finalText).toMatch(/^Los museos más populares de Porto, según las reseñas de Google: .*Museo de Arte Contemporáneo de Serralves.* Encima de los hoteles tienes un plan para cada día\. /);
    expect(turn.finalText).toContain('cerca de los museos');
    expect(turn.finalText).not.toMatch(/the museums|popular museums/);
  });

  it('closeness already wanted: the line does not say "already set"', async () => {
    const { session, supplier } = await onboarded();
    const stay = await stayOf(session.id);
    await dispatchActions({ session, stay, actions: [{ type: 'set_priorities', priorities: ['closest'] }], supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    const turn = await say(await fresh(session.id), 'I want to tour some museums', deps(supplier.supplier, recordedSights(session.id).find));
    expect(turn.finalText).toMatch(/A plan for each day is above the hotels\.$/);
    expect(turn.resultMeta).toMatchObject({ applied: 1, rejected: [] });
  });

  it('asking again changes nothing and says so; Google is still only a lookup', async () => {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id);
    await say(session, 'I want to tour some museums', deps(supplier.supplier, sights.find));
    const again = await say(await fresh(session.id), 'museums please', deps(supplier.supplier, sights.find));
    expect(again.finalText).toBe('That is already how the search is set.');
    expect(supplier.searches).toHaveLength(2);
  });
});

describe('when the lookup cannot help, nothing changes and the line says why', () => {
  it('Google refuses or is down', async () => {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id, 'nearby-error-bad-type');
    const turn = await say(session, 'I want to tour some museums', deps(supplier.supplier, sights.find));
    expect(turn.finalText).toBe('The lookup for places to visit did not answer, so nothing was changed. Try again in a moment.');
    expect(await stayOf(session.id)).toMatchObject({ sights: null, nearPlaceId: null });
    // Nothing at all: what "best" means is as it was, and no search was made.
    expect((await fresh(session.id)).priorities).toEqual(['cheapest']);
    expect(supplier.searches).toHaveLength(1);
    // The failure is on the ledger, at no cost.
    expect(await rawQuery("select success, cost_microcents::int as cost from usage_events where provider = 'google:places'")).toEqual([{ success: false, cost: 0 }]);
  });

  it('no key on the server: no call, no ledger row, the same line', async () => {
    const { session, supplier } = await onboarded();
    const find: FindSights = async () => ({ ok: false, error: 'not_configured' });
    const turn = await say(session, 'I want to tour some museums', deps(supplier.supplier, find));
    expect(turn.finalText).toBe('The lookup for places to visit did not answer, so nothing was changed. Try again in a moment.');
    expect(await rawQuery("select 1 from usage_events where provider = 'google:places'")).toEqual([]);
  });

  it('too few well-rated places of that kind', async () => {
    const { session, supplier } = await onboarded();
    // The recorded museums asked for as galleries: none is a gallery, so none is kept.
    const sights = recordedSights(session.id, 'nearby-museums-porto');
    const turn = await say(session, 'art galleries', deps(supplier.supplier, sights.find, { askJev: async () => jevSays({ sightKind: sure('galleries') }) }));
    expect(turn.finalText).toBe('I could not find enough well-rated places of that kind near where you are searching, so nothing was changed.');
    expect((await fresh(session.id)).priorities).toEqual(['cheapest']);
    expect((await stayOf(session.id)).sights).toBeNull();
  });

  it('a destination with no point to look around', async () => {
    const supplier = recordedSupplier({ place: 'fail' });
    const session = await createSession({ anonId: 'anon-2' });
    await askQuestion(session.id, 'destination');
    let guestsAnswered = false;
    for (const answer of ANSWERS) {
      await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    expect(await stayOf(session.id)).toMatchObject({ destLatitude: null });
    const sights = recordedSights(session.id);
    const turn = await say(await fresh(session.id), 'I want to tour some museums', deps(supplier.supplier, sights.find));
    expect(turn.finalText).toBe('The lookup for places to visit did not answer, so nothing was changed. Try again in a moment.');
    expect(sights.calls).toHaveLength(0); // nowhere to look around, so Google is not asked
  });
});

describe('"actually I want to go 4 nights and tour some museums": two requests, so the agent', () => {
  it('both are applied in one turn, and four nights have time for all eight', async () => {
    const { session, supplier } = await onboarded();
    const m = scripted([
      { tool: 'set_dates', input: { check_in: '2026-12-11', check_out: '2026-12-15' } },
      { tool: 'plan_sights', input: { kind: 'museums' } },
    ]);
    const turn = await say(session, 'actually I want to go 4 nights and tour some museums', deps(supplier.supplier, recordedSights(session.id).find, { askJev: async () => JEV_DOWN, callModel: m.callModel }));

    expect(m.calls()).toBe(1);
    const names = POPULAR.map((p) => p.name);
    expect(turn.finalText).toBe(
      `11–15 Dec, 4 nights. The most popular museums in Porto, by Google reviews: ${names.slice(0, 3).join(', ')} and ${names[3]}, and 4 more. A plan for each day is above the hotels. Ranked for low price and being close to the museums.`,
    );
    // Not the model's words: it wrote none, and named no museum.
    expect((await listMessages(session.id)).at(-1)).toMatchObject({ role: 'assistant', kind: 'line' });
    const stay = await stayOf(session.id);
    const centre = sightsCentre({ kind: 'museums', places: POPULAR }, 4)!;
    expect(stay).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-15', nearPlaceId: 'sights:museums', latitude: centre.latitude, longitude: centre.longitude });
    expect((await buildSessionView(await fresh(session.id), 'en', RECORDED_AT)).stay!.sights!.places).toHaveLength(8);
  });

  it('the agent can drop them again', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'I want to tour some museums', deps(supplier.supplier, recordedSights(session.id).find));
    const m = scripted([{ tool: 'clear_sights', input: {} }]);
    const turn = await say(await fresh(session.id), 'forget the museums', deps(supplier.supplier, recordedSights(session.id).find, { askJev: async () => JEV_DOWN, callModel: m.callModel }));
    expect(turn.finalText).toBe('Close to central Porto again.');
    expect(await stayOf(session.id)).toMatchObject({ sights: null, nearPlaceId: null, nearLabel: null, latitude: null });
  });
});

describe('the plan\'s own controls', () => {
  it('"Remove the plan" is the near chip\'s clear: the sights go with it', async () => {
    const { session, supplier } = await onboarded();
    await say(session, 'I want to tour some museums', deps(supplier.supplier, recordedSights(session.id).find));
    const out = await dispatchActions({ session: await fresh(session.id), stay: await stayOf(session.id), actions: [{ type: 'clear_near' }], supplier: supplier.supplier, now: RECORDED_AT, today: TODAY });
    expect(out.results).toMatchObject([{ ok: true }]);
    expect(await stayOf(session.id)).toMatchObject({ sights: null, nearPlaceId: null });
    expect((await buildSessionView(await fresh(session.id), 'en', RECORDED_AT)).stay).toMatchObject({ sights: null, nearIsNamed: false });
  });

  it('a longer stay, changed from the chip, brings more of the same museums into play without asking Google again', async () => {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id);
    await say(session, 'I want to tour some museums', deps(supplier.supplier, sights.find));
    await dispatchActions({ session: await fresh(session.id), stay: await stayOf(session.id), actions: [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-14' }], supplier: supplier.supplier, now: RECORDED_AT, today: TODAY, findSights: sights.find });
    expect(sights.calls).toHaveLength(1);
    const centre = sightsCentre({ kind: 'museums', places: POPULAR }, 3)!;
    expect(await stayOf(session.id)).toMatchObject({ latitude: centre.latitude, longitude: centre.longitude });
    expect((await buildSessionView(await fresh(session.id), 'en', RECORDED_AT)).stay!.sights!.places).toEqual(POPULAR.slice(0, 6));
  });
});

/** Google's terms: names, points and ratings 30 days at most (docs/sights.md). Sam, 2026-11-14: a tool deletes them. */
describe('the 30-day purge', () => {
  const DAY = 86_400_000;
  async function toured() {
    const { session, supplier } = await onboarded();
    const sights = recordedSights(session.id);
    const turn = await say(session, 'I want to tour some museums', deps(supplier.supplier, sights.find));
    expect(turn.status).toBe('done');
    return session;
  }

  it('keeps them for 30 days, then removes the places, the point between them and every line that named one', async () => {
    const session = await toured();
    const before = await stayOf(session.id);
    const lineBefore = (await listMessages(session.id)).filter((m) => m.role === 'assistant').at(-1)!.content;
    expect(lineBefore).toContain('FC Porto Museum');

    // 30 days to the millisecond: still kept.
    expect(await purgeExpiredSights(new Date(RECORDED_AT.getTime() + 30 * DAY), expiredSightsLine)).toEqual({ stays: 0, lines: 0 });
    expect((await stayOf(session.id)).sights).toEqual(before.sights);

    const result = await purgeExpiredSights(new Date(RECORDED_AT.getTime() + 30 * DAY + 1), expiredSightsLine);
    expect(result).toEqual({ stays: 1, lines: 1 });
    const after = await stayOf(session.id);
    expect(after).toMatchObject({ sights: null, nearPlaceId: null, nearLabel: null, latitude: null, longitude: null });
    // What is not Google's stays: the search, its dates and what "best" means.
    expect(after).toMatchObject({ placeId: before.placeId, checkIn: before.checkIn, checkOut: before.checkOut });
    expect((await fresh(session.id)).priorities).toEqual(['cheapest', 'closest']);

    // No name, point or rating from Google is left anywhere in the search.
    const names = POPULAR.map((p) => p.name);
    const said = await rawQuery<{ content: string; meta: unknown }>('select content, meta from chat_history where session_id = $1 and role = $2 order by seq', [session.id, 'assistant']);
    const replies = await rawQuery<{ final_text: string | null }>('select final_text from agent_turns where session_id = $1 order by created_at', [session.id]);
    for (const text of [...said.map((m) => m.content), ...replies.map((r) => r.final_text ?? '')]) for (const n of names) expect(text).not.toContain(n);
    expect(said.at(-1)).toEqual({ content: 'This list of museums was more than 30 days old, so it was removed. Ask again for today\'s.', meta: expect.objectContaining({ sightsExpired: true }) });
    expect(replies.at(-1)?.final_text).toBe('This list of museums was more than 30 days old, so it was removed. Ask again for today\'s.');

    // The screen has no plan and no "close to the museums" any more.
    const view = await buildSessionView(await fresh(session.id), 'en');
    expect(view.stay?.sights).toBeNull();

    // A second run finds nothing left to do.
    expect(await purgeExpiredSights(new Date(RECORDED_AT.getTime() + 60 * DAY), expiredSightsLine)).toEqual({ stays: 0, lines: 0 });
  });

  it('a stay with no fetchedAt (written before the stamp) is treated as expired', async () => {
    const session = await toured();
    await rawQuery("update stays set sights = sights - 'fetchedAt' where session_id = $1", [session.id]);
    expect(await purgeExpiredSights(RECORDED_AT, expiredSightsLine)).toMatchObject({ stays: 1 });
    expect((await stayOf(session.id)).sights).toBeNull();
  });

  it('a "close to" that is not the sights is kept', async () => {
    const session = await toured();
    await rawQuery("update stays set near_place_id = 'place-ribeira', near_label = 'Ribeira', latitude = 41.14, longitude = -8.61 where session_id = $1", [session.id]);
    await purgeExpiredSights(new Date(RECORDED_AT.getTime() + 31 * DAY), expiredSightsLine);
    expect(await stayOf(session.id)).toMatchObject({ sights: null, nearPlaceId: 'place-ribeira', nearLabel: 'Ribeira', latitude: 41.14, longitude: -8.61 });
  });

  it('the expired line is in the language the old line was in', () => {
    expect(expiredSightsLine('museums', 'Los museos más populares de Oporto, según las reseñas de Google: …')).toBe('Esta lista de museos tenía más de 30 días, así que se ha borrado. Pídela otra vez para ver la de hoy.');
    expect(expiredSightsLine('galleries', 'The most popular art galleries in Porto, by Google reviews: …')).toBe('This list of art galleries was more than 30 days old, so it was removed. Ask again for today\'s.');
  });
});

import { expect, stranger, test } from '../fixtures/test';
import { uniqueEmail } from '../support/env';
import { expectError, json, type Api } from '../support/api';
import { addDays, canonicalDates, todayLocal } from '../support/dates';
import * as S from '../support/schemas';

/**
 * A search as the API sees it: started from the first screen (brief) or by
 * the questions (session + form), read back (session/[id]), changed by the
 * header chips (edit), and the A/B events. Every route checks the search is
 * this visitor's: anyone else gets 404 session_not_found, which does not say
 * whether it exists.
 */
const today = () => todayLocal();
const ANOTHER = '00000000-0000-4000-8000-000000000000';


test.describe('POST /api/session', { tag: '@api' }, () => {
  test('starts a search owned by this browser, with the first question asked', async ({ api }) => {
    const res = await api.newSession();
    const { sessionId } = await json(res, S.sessionIdBody);
    expect(res.headersArray().some((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('hf_anon='))).toBe(true);
    const view = await json(await api.session(sessionId), S.sessionView);
    expect(view.session.status).toBe('onboarding');
    expect(view.stay).toBeNull();
    expect(view.shortlist).toEqual([]);
    expect(view.messages).toEqual([expect.objectContaining({ role: 'assistant', kind: 'form_question', content: 'Where are you going?', meta: { field: 'destination' } })]);
  });

  test('twenty a minute per client, the 21st is rate_limited', async ({ api }) => {
    for (let i = 0; i < 20; i++) expect((await api.newSession()).status()).toBe(200);
    await expectError(await api.newSession(), 429, 'rate_limited');
  });
});

test.describe('GET /api/session', { tag: '@api' }, () => {
  test('no cookie: no trips', async ({ api }) => {
    expect(await json(await api.trips(), S.tripsBody)).toEqual({ trips: [] });
  });

  test('this visitor\'s trips, newest first; a search without a place and dates is not one yet', async ({ api }) => {
    await json(await api.newSession(), S.sessionIdBody);
    const first = await api.search();
    const second = await api.search({ dates: { checkIn: addDays(canonicalDates().checkIn, 7), checkOut: addDays(canonicalDates().checkIn, 9) } });
    const { trips } = await json(await api.trips(), S.tripsBody);
    expect(trips.map((t) => t.id)).toEqual([second.sessionId, first.sessionId]);
    expect(trips[1]).toEqual({ id: first.sessionId, status: 'active', destination: 'Porto, Portugal', checkIn: canonicalDates().checkIn, checkOut: canonicalDates().checkOut });
  });

  test('another visitor\'s trips are not listed', async ({ api, ip }) => {
    await api.search();
    const other = await stranger(ip);
    expect(await json(await other.get('api/session'), S.tripsBody)).toEqual({ trips: [] });
    await other.dispose();
  });
});

test.describe('POST /api/session/brief', { tag: '@api' }, () => {
  test('a picked place and nights: the first search runs in the same request', async ({ api }) => {
    const { view } = await api.search({ priorities: ['cheapest', 'nicest'] });
    expect(view.session.status).toBe('active');
    expect(view.stay).toMatchObject({ destination: 'Porto, Portugal', ...canonicalDates(), adults: 2, childrenAges: [], rooms: 1 });
    expect([...view.session.priorities!].sort()).toEqual(['cheapest', 'nicest']);
    expect(view.shortlist.length).toBeGreaterThan(0);
    expect(view.shortlist.length).toBeLessThanOrEqual(5);
    expect(view.shortlist.map((r) => r.rank)).toEqual(view.shortlist.map((_, i) => i + 1));
    // The pills already said it: the bubble, and no "From your message" read-back.
    expect(view.messages[0]).toMatchObject({ role: 'user', content: 'Porto, Portugal' });
    expect(view.messages.some((m) => m.content.startsWith('From your message'))).toBe(false);
    // Invariant 7: an anonymous search gets public prices only.
    expect(view.session.audience).toBe('public');
    for (const r of view.shortlist) expect(r.offer?.audience ?? 'public').toBe('public');
  });

  test('no dates and nothing about when in the words: tonight, one night', async ({ api }) => {
    const { view } = await api.search({ dates: null });
    expect(view.stay).toMatchObject({ checkIn: today(), checkOut: addDays(today(), 1) });
  });

  test('a party from the Who pill, with a child and a pet, is the stay\'s', async ({ api }) => {
    const { view } = await api.search({ guests: { adults: 3, childrenAges: [5], rooms: 2, pets: true } });
    expect(view.stay).toMatchObject({ adults: 3, childrenAges: [5], rooms: 2 });
    expect(view.stay!.mustHaves).toContain('pets_allowed');
    expect(view.messages[0].content).toBe('Porto, Portugal · 3 adults, 1 child (5), 2 rooms, with a pet');
  });

  test('each refusal before anything is stored: its code, and no trip left behind', async ({ api }) => {
    const porto = await api.porto();
    const d = canonicalDates();
    const cases: Array<[unknown, number, Parameters<typeof expectError>[2]]> = [
      [{ brief: {}, today: today() }, 400, 'empty_brief'],
      [{ brief: { text: '   ' }, today: today() }, 400, 'empty_brief'],
      [{ brief: { place: porto, dates: { checkIn: addDays(today(), -3), checkOut: addDays(today(), -1) } }, today: today() }, 400, 'dates_in_past'],
      [{ brief: { place: porto, dates: { checkIn: d.checkIn, checkOut: d.checkIn } }, today: today() }, 400, 'checkout_not_after_checkin'],
      [{ brief: { place: porto, dates: { checkIn: d.checkOut, checkOut: d.checkIn } }, today: today() }, 400, 'checkout_not_after_checkin'],
      [{ brief: { place: porto, dates: { checkIn: d.checkIn, checkOut: addDays(d.checkIn, 31) } }, today: today() }, 400, 'stay_too_long'],
      [{ brief: { place: porto, guests: { adults: 1, childrenAges: [], rooms: 2, pets: false } }, today: today() }, 400, 'more_rooms_than_adults'],
      [{ brief: { place: porto }, today: '2001-01-01' }, 400, 'bad_date'],
      [{ brief: { place: porto }, today: addDays(today(), 3) }, 400, 'bad_date'],
      [{ brief: { place: porto } }, 400, 'invalid_request'],
      [{ brief: { place: porto, extra: 1 }, today: today() }, 400, 'invalid_request'],
      [{ brief: { place: porto, priorities: ['cheapest', 'cheapest'] }, today: today() }, 400, 'invalid_request'],
      [{ brief: { place: porto, priorities: ['fastest'] }, today: today() }, 400, 'invalid_request'],
      [{ brief: { place: porto, guests: { adults: 13, childrenAges: [], rooms: 1, pets: false } }, today: today() }, 400, 'invalid_request'],
      [{ brief: { place: porto, guests: { adults: 2, childrenAges: [18], rooms: 1, pets: false } }, today: today() }, 400, 'invalid_request'],
      [{ brief: { text: 'x'.repeat(1001) }, today: today() }, 400, 'invalid_request'],
      [{ brief: { place: { placeId: '', label: 'x' } }, today: today() }, 400, 'invalid_request'],
    ];
    for (const [body, status, code] of cases) await expectError(await api.brief(body), status, code);
    expect(await json(await api.trips(), S.tripsBody)).toEqual({ trips: [] });
  });

  test('twenty a minute per client (shared with POST /api/session)', async ({ api }) => {
    for (let i = 0; i < 20; i++) await api.newSession();
    await expectError(await api.brief({ brief: { text: 'porto' }, today: today() }), 429, 'rate_limited');
  });
});

test.describe('GET /api/session/[id]', { tag: '@api' }, () => {
  test('everything the page renders, in the strict shape, with no supplier ids', async ({ api, searched }) => {
    const view = await json(await api.session(searched.sessionId), S.sessionView);
    expect(view.session.id).toBe(searched.sessionId);
    expect(view.session.currency).toMatch(/^[A-Z]{3}$/);
    for (const r of view.shortlist) {
      if (!r.offer) continue;
      expect(Date.parse(r.offer.expiresAt)).toBeGreaterThan(Date.parse(r.offer.fetchedAt));
      expect(r.offer.currency).toBe(view.session.currency);
    }
  });

  test('not this visitor\'s, unknown, or no cookie at all: 404 session_not_found, the same answer', async ({ api, searched, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.get(`api/session/${searched.sessionId}`), 404, 'session_not_found');
    await expectError(await api.session(ANOTHER), 404, 'session_not_found');
    await expectError(await other.get(`api/session/${ANOTHER}`), 404, 'session_not_found');
    await other.dispose();
  });

  test('an id that is not a uuid is 404 session_not_found, not a server error', async ({ api }) => {
    for (const id of ['not-a-uuid', 'a'.repeat(36), '0'.repeat(36), `${'f'.repeat(8)}-${'f'.repeat(27)}`]) {
      const res = await api.session(id);
      if (res.status() === 500) expect((await res.json()).ref, 'a 500 carries its ref').toMatch(/^[0-9a-f]{8}$/);
      await expectError(res, 404, 'session_not_found');
    }
  });

  test('a signed-in visitor\'s searches are the account\'s: the anonymous search is adopted at sign-in', async ({ visitor }) => {
    const api = visitor.api();
    const { sessionId } = await api.search();
    await api.signIn(uniqueEmail('adopt'));
    const view = await json(await api.session(sessionId), S.sessionView);
    expect(view.session.signedIn).toBe(true);
  });
});

test.describe('POST /api/session/[id]/form', { tag: '@api' }, () => {
  async function onboarding(api: Api) {
    return (await json(await api.newSession(), S.sessionIdBody)).sessionId;
  }

  test('answers in order: destination, nights, party, priorities; the last one runs the search', async ({ api }) => {
    const id = await onboarding(api);
    const porto = await api.porto();
    let view = await json(await api.form(id, { answer: { field: 'destination', ...porto }, today: today() }), S.sessionView);
    expect(view.messages.at(-1)).toMatchObject({ kind: 'form_question', content: 'Which nights?' });
    view = await json(await api.form(id, { answer: { field: 'dates', ...canonicalDates() }, today: today() }), S.sessionView);
    expect(view.messages.at(-1)).toMatchObject({ kind: 'form_question', content: 'Who is travelling?' });
    view = await json(await api.form(id, { answer: { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false }, today: today() }), S.sessionView);
    expect(view.messages.at(-1)).toMatchObject({ kind: 'form_question', meta: expect.objectContaining({ field: 'priorities', near: 'central Porto' }) });
    view = await json(await api.form(id, { answer: { field: 'priorities', priorities: ['nicest'] }, today: today() }), S.sessionView);
    expect(view.session.status).toBe('active');
    expect(view.session.priorities).toEqual(['nicest']);
    expect(view.shortlist.length).toBeGreaterThan(0);
  });

  test('an answer to a question not being asked is wrong_step (409)', async ({ api }) => {
    const id = await onboarding(api);
    await expectError(await api.form(id, { answer: { field: 'dates', ...canonicalDates() }, today: today() }), 409, 'wrong_step');
    await expectError(await api.form(id, { answer: { field: 'priorities', priorities: [] }, today: today() }), 409, 'wrong_step');
  });

  test('nights refused with their codes', async ({ api }) => {
    const id = await onboarding(api);
    await json(await api.form(id, { answer: { field: 'destination', ...(await api.porto()) }, today: today() }), S.sessionView);
    const d = canonicalDates();
    await expectError(await api.form(id, { answer: { field: 'dates', checkIn: addDays(today(), -2), checkOut: today() }, today: today() }), 400, 'dates_in_past');
    await expectError(await api.form(id, { answer: { field: 'dates', checkIn: d.checkIn, checkOut: d.checkIn }, today: today() }), 400, 'checkout_not_after_checkin');
    await expectError(await api.form(id, { answer: { field: 'dates', checkIn: d.checkIn, checkOut: addDays(d.checkIn, 31) }, today: today() }), 400, 'stay_too_long');
    await expectError(await api.form(id, { answer: { field: 'dates', ...d }, today: '2001-01-01' }), 400, 'bad_date');
  });

  test('a party with more rooms than adults is more_rooms_than_adults', async ({ api }) => {
    const id = await onboarding(api);
    await json(await api.form(id, { answer: { field: 'destination', ...(await api.porto()) }, today: today() }), S.sessionView);
    await json(await api.form(id, { answer: { field: 'dates', ...canonicalDates() }, today: today() }), S.sessionView);
    await expectError(await api.form(id, { answer: { field: 'guests', adults: 1, childrenAges: [], rooms: 2, pets: false }, today: today() }), 400, 'more_rooms_than_adults');
  });

  test('a search already set up is not_onboarding', async ({ api, searched }) => {
    await expectError(await api.form(searched.sessionId, { answer: { field: 'priorities', priorities: [] }, today: today() }), 400, 'not_onboarding');
  });

  test('a malformed answer is invalid_request; another visitor\'s search is session_not_found', async ({ api, ip }) => {
    const id = await onboarding(api);
    await expectError(await api.form(id, { answer: { field: 'budget', amount: 3 }, today: today() }), 400, 'invalid_request');
    await expectError(await api.form(id, { answer: { field: 'destination', placeId: 'x', label: 'y' } }), 400, 'invalid_request');
    const other = await stranger(ip);
    await expectError(await other.post(`api/session/${id}/form`, { data: { answer: { field: 'destination', ...(await api.porto()) }, today: today() } }), 404, 'session_not_found');
    await other.dispose();
  });
});

test.describe('POST /api/session/[id]/edit', { tag: '@api' }, () => {
  test('a chip change re-ranks and says so in one chat line that later chip changes rewrite', async ({ api, searched }) => {
    let view = await json(await api.edit(searched.sessionId, { actions: [{ type: 'set_priorities', priorities: ['cheapest'] }], today: today() }), S.sessionView);
    expect(view.session.priorities).toEqual(['cheapest']);
    const lines = () => view.messages.filter((m) => m.content.startsWith('Ranked for'));
    expect(lines().map((m) => m.content)).toEqual([expect.stringMatching(/^Ranked for low price\. \d+ of \d+ hotels fit\.$/)]);
    view = await json(await api.edit(searched.sessionId, { actions: [{ type: 'set_priorities', priorities: ['nicest'] }], today: today() }), S.sessionView);
    expect(lines().map((m) => m.content)).toEqual([expect.stringMatching(/^Ranked for great reviews\. \d+ of \d+ hotels fit\.$/)]);
    const totals = view.shortlist.map((r) => r.rank);
    expect(totals).toEqual(totals.map((_, i) => i + 1));
  });

  test('the party and the pet together (the Who chip), and the nationality', async ({ api, searched }) => {
    let view = await json(
      await api.edit(searched.sessionId, { actions: [{ type: 'set_guests', adults: 3, childrenAges: [], rooms: 1 }, { type: 'add_must_have', mustHave: 'pets_allowed' }], today: today() }),
      S.sessionView,
    );
    expect(view.stay).toMatchObject({ adults: 3 });
    expect(view.stay!.mustHaves).toContain('pets_allowed');
    view = await json(await api.edit(searched.sessionId, { actions: [{ type: 'set_nationality', code: 'DE' }], today: today() }), S.sessionView);
    expect(view.session).toMatchObject({ guestNationality: 'DE', nationalitySource: 'user' });
  });

  test('a point on the map, then back to the destination', async ({ api, searched }) => {
    let view = await json(await api.edit(searched.sessionId, { actions: [{ type: 'set_near_point', latitude: 41.1414, longitude: -8.6111, label: 'Ribeira' }], today: today() }), S.sessionView);
    expect(view.stay).toMatchObject({ nearIsNamed: true, nearLabel: 'Ribeira', anchor: { label: 'Ribeira' } });
    view = await json(await api.edit(searched.sessionId, { actions: [{ type: 'clear_near' }], today: today() }), S.sessionView);
    expect(view.stay).toMatchObject({ nearIsNamed: false, nearLabel: 'central Porto' });
  });

  test('refusals with their codes', async ({ api, searched }) => {
    const d = canonicalDates();
    const id = searched.sessionId;
    await expectError(await api.edit(id, { actions: [{ type: 'set_dates', checkIn: addDays(today(), -3), checkOut: today() }], today: today() }), 400, 'dates_in_past');
    await expectError(await api.edit(id, { actions: [{ type: 'set_dates', checkIn: d.checkOut, checkOut: d.checkIn }], today: today() }), 400, 'checkout_not_after_checkin');
    await expectError(await api.edit(id, { actions: [{ type: 'set_dates', checkIn: d.checkIn, checkOut: addDays(d.checkIn, 31) }], today: today() }), 400, 'stay_too_long');
    await expectError(await api.edit(id, { actions: [{ type: 'set_guests', adults: 1, childrenAges: [], rooms: 2 }], today: today() }), 400, 'more_rooms_than_adults');
    await expectError(await api.edit(id, { actions: [{ type: 'set_nationality', code: 'XX' }], today: today() }), 400, 'unknown_country');
    await expectError(await api.edit(id, { actions: [{ type: 'set_near_point', latitude: -33.86, longitude: 151.2, label: 'Sydney' }], today: today() }), 400, 'near_too_far');
    await expectError(await api.edit(id, { actions: [{ type: 'set_priorities', priorities: [] }], today: '2001-01-01' }), 400, 'bad_date');
    // Only the chips' own actions; a few at a time.
    await expectError(await api.edit(id, { actions: [{ type: 'set_price_cap', perNightMinor: 10000 }], today: today() }), 400, 'invalid_request');
    await expectError(await api.edit(id, { actions: [{ type: 'reset_exclusions' }], today: today() }), 400, 'invalid_request');
    await expectError(await api.edit(id, { actions: [], today: today() }), 400, 'invalid_request');
    await expectError(await api.edit(id, { actions: Array(4).fill({ type: 'clear_near' }), today: today() }), 400, 'invalid_request');
    // The search is unchanged by all of that.
    const view = await json(await api.session(id), S.sessionView);
    expect(view.stay).toMatchObject({ ...d, adults: 2, rooms: 1 });
  });

  test('a search still being set up is not_active (409); another visitor\'s is session_not_found', async ({ api, searched, ip }) => {
    const { sessionId } = await json(await api.newSession(), S.sessionIdBody);
    await expectError(await api.edit(sessionId, { actions: [{ type: 'set_priorities', priorities: [] }], today: today() }), 409, 'not_active');
    const other = await stranger(ip);
    await expectError(await other.post(`api/session/${searched.sessionId}/edit`, { data: { actions: [{ type: 'set_priorities', priorities: [] }], today: today() } }), 404, 'session_not_found');
    await other.dispose();
  });
});

test.describe('POST /api/events', { tag: '@api' }, () => {
  test('a detail open or Book press for this visitor\'s search: ok', async ({ api, searched }) => {
    for (const name of ['detail_open', 'detail_book'])
      for (const variant of ['expand', 'slideout']) expect(await json(await api.events({ name, variant, sessionId: searched.sessionId }), S.okBody)).toEqual({ ok: true });
  });

  test('an unknown event or variant is invalid_request; another visitor\'s search is session_not_found', async ({ api, searched, ip }) => {
    await expectError(await api.events({ name: 'page_view', variant: 'expand', sessionId: searched.sessionId }), 400, 'invalid_request');
    await expectError(await api.events({ name: 'detail_open', variant: 'modal', sessionId: searched.sessionId }), 400, 'invalid_request');
    await expectError(await api.events({ name: 'detail_open', variant: 'expand', sessionId: 'nope' }), 400, 'invalid_request');
    await expectError(await api.events({ name: 'detail_open', variant: 'expand', sessionId: searched.sessionId, email: 'x@y.z' }), 400, 'invalid_request');
    const other = await stranger(ip);
    await expectError(await other.post('api/events', { data: { name: 'detail_open', variant: 'expand', sessionId: searched.sessionId } }), 404, 'session_not_found');
    await other.dispose();
  });
});

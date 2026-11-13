import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { pgError, rawQuery, resetDb, seedUser } from './harness';
import { RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { dispatchActions } from '@/server/dispatch';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { insertOffers } from '@/server/repos/offers';
import { adoptAnonymousSaved, listSaved, listSavedPropertyIds, saveHotel, unsaveHotel } from '@/server/repos/saved';
import { adoptAnonymousSessions, createSession, getSession, listStays } from '@/server/repos/sessions';
import { saveFromSearch, savedView } from '@/server/saved';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'priorities', priorities: ['cheapest'] },
];

/** An anonymous visitor's Porto search, answered through the form against the recorded sandbox. */
async function searched(anonId = 'anon-saved') {
  const recorded = recordedSupplier();
  const session = await createSession({ anonId });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: recorded.supplier, now: RECORDED_AT, today: '2026-11-11' });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  const current = (await getSession(session.id))!;
  return { recorded, session: current, stay: (await listStays(current.id))[0], view: await buildSessionView(current) };
}

describe('saved hotels', () => {
  it('a hotel on the list is saved once, with the last price found, its nights and the day it was fetched', async () => {
    const t = await searched();
    const row = t.view.shortlist[0];
    expect(await saveFromSearch(t.session, row.property.id)).toEqual({ ok: true, name: row.property.name });
    expect(await saveFromSearch(t.session, row.property.id)).toMatchObject({ ok: true });
    expect(await rawQuery('select 1 from saved_hotels')).toHaveLength(1);

    const [saved] = await savedView({ anonId: 'anon-saved' });
    expect(saved).toMatchObject({
      propertyId: row.property.id,
      name: row.property.name,
      sessionId: t.session.id,
      lastFound: { totalMinor: row.offer!.totalMinor, currency: 'EUR', checkIn: '2026-12-11', checkOut: '2026-12-13', fetchedAt: RECORDED_AT.toISOString() },
    });
    // No supplier id reaches the client.
    expect(JSON.stringify(saved)).not.toMatch(/supplier/i);
  });

  it('a hotel that is not on the visitor\'s list cannot be saved through a search', async () => {
    const t = await searched();
    expect(await saveFromSearch(t.session, crypto.randomUUID())).toEqual({ ok: false, error: 'property_not_found' });
    expect(await rawQuery('select 1 from saved_hotels')).toHaveLength(0);
  });

  it('belongs to the cookie that saved it: another visitor sees nothing, and unsaving is per owner', async () => {
    const t = await searched();
    const id = t.view.shortlist[1].property.id;
    await saveFromSearch(t.session, id);
    expect(await listSavedPropertyIds({ anonId: 'someone-else' })).toEqual([]);
    expect(await unsaveHotel({ anonId: 'someone-else' }, id)).toBe(false);
    expect(await listSavedPropertyIds({ anonId: 'anon-saved' })).toEqual([id]);
    expect(await unsaveHotel({ anonId: 'anon-saved' }, id)).toBe(true);
    expect(await listSaved({ anonId: 'anon-saved' })).toEqual([]);
  });

  it('the last price found follows the newest search, and says the nights it was for', async () => {
    const t = await searched();
    const id = t.view.shortlist[0].property.id;
    await saveFromSearch(t.session, id);
    const later = new Date(RECORDED_AT.getTime() + 60_000);
    await dispatchActions({ session: t.session, stay: t.stay, actions: [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-14' }], supplier: t.recorded.supplier, now: later, today: '2026-11-11' });
    const [saved] = await savedView({ anonId: 'anon-saved' });
    expect(saved.lastFound).toMatchObject({ checkIn: '2026-12-11', checkOut: '2026-12-14', fetchedAt: later.toISOString() });
  });

  it('a member price never reaches an anonymous visitor, even one held in their own search', async () => {
    const t = await searched();
    const row = t.view.shortlist[0];
    await saveFromSearch(t.session, row.property.id);
    const later = new Date(RECORDED_AT.getTime() + 60_000);
    // A newer, cheaper, member-only row for the same hotel in the same search.
    await insertOffers([
      {
        sessionId: t.session.id,
        stayId: t.stay.id,
        propertyId: row.property.id,
        supplier: 'liteapi',
        supplierOfferId: 'member-only',
        audience: 'member',
        marginPct: '3.00',
        currency: 'EUR',
        totalMinor: 1,
        payAtPropertyMinor: 0,
        fetchedAt: later,
        expiresAt: new Date(later.getTime() + 60_000),
      },
    ]);
    const [saved] = await savedView({ anonId: 'anon-saved' });
    expect(saved.lastFound?.totalMinor).toBe(row.offer!.totalMinor);
    expect(saved.lastFound?.fetchedAt).toBe(RECORDED_AT.toISOString());
  });

  it('a hotel\'s other rooms (detail rates) are not the price shown', async () => {
    const t = await searched();
    const row = t.view.shortlist[0];
    await saveFromSearch(t.session, row.property.id);
    const later = new Date(RECORDED_AT.getTime() + 60_000);
    await insertOffers([
      { sessionId: t.session.id, stayId: t.stay.id, propertyId: row.property.id, supplier: 'liteapi', supplierOfferId: 'suite', audience: 'public', marginPct: '15.00', currency: 'EUR', totalMinor: 99999, payAtPropertyMinor: 0, fetchedAt: later, expiresAt: new Date(later.getTime() + 60_000), detailOnly: true },
    ]);
    expect((await savedView({ anonId: 'anon-saved' }))[0].lastFound?.totalMinor).toBe(row.offer!.totalMinor);
  });

  it('at sign-in the cookie\'s saved hotels become the account\'s, once each, with the prices of the searches adopted with them', async () => {
    const t = await searched();
    const [a, b] = t.view.shortlist.map((r) => r.property.id);
    await saveFromSearch(t.session, a);
    await saveFromSearch(t.session, b);
    const user = await seedUser();
    await saveHotel({ userId: user.id }, { propertyId: b, sessionId: null });

    await adoptAnonymousSessions('anon-saved', user.id);
    expect(await adoptAnonymousSaved('anon-saved', user.id)).toBe(1);

    expect((await listSavedPropertyIds({ userId: user.id })).sort()).toEqual([a, b].sort());
    expect(await rawQuery('select 1 from saved_hotels')).toHaveLength(2);
    expect(await listSavedPropertyIds({ anonId: 'anon-saved' })).toEqual([]);
    const view = await savedView({ userId: user.id });
    expect(view.every((s) => s.lastFound?.currency === 'EUR')).toBe(true);
    // A second account on the same browser adopts nothing already handed over.
    const other = await seedUser();
    expect(await adoptAnonymousSaved('anon-saved', other.id)).toBe(0);
  });

  it('after sign-in the cookie no longer reads prices from the searches it handed over', async () => {
    const first = await searched();
    const id = first.view.shortlist[0].property.id;
    const user = await seedUser();
    await adoptAnonymousSessions('anon-saved', user.id);
    const later = new Date(RECORDED_AT.getTime() + 60_000);
    // The account's search, now theirs, is priced again later.
    await insertOffers([
      { sessionId: first.session.id, stayId: first.stay.id, propertyId: id, supplier: 'liteapi', supplierOfferId: 'account', audience: 'public', marginPct: '15.00', currency: 'EUR', totalMinor: 77777, payAtPropertyMinor: 0, fetchedAt: later, expiresAt: new Date(later.getTime() + 60_000) },
    ]);
    // Signed out on the same browser, the cookie searches and saves the same hotel.
    const again = await searched('anon-saved');
    await saveFromSearch(again.session, id);
    const [saved] = await savedView({ anonId: 'anon-saved' });
    expect(saved.lastFound?.fetchedAt).toBe(RECORDED_AT.toISOString());
    expect(saved.lastFound?.totalMinor).not.toBe(77777);
  });

  it('the database holds one row per owner and hotel, and refuses a row with no owner', async () => {
    const t = await searched();
    const id = t.view.shortlist[0].property.id;
    await rawQuery('insert into saved_hotels (anon_id, property_id) values ($1, $2)', ['x', id]);
    expect(await pgError(rawQuery('insert into saved_hotels (anon_id, property_id) values ($1, $2)', ['x', id]))).toMatchObject({ code: '23505' });
    expect(await pgError(rawQuery('insert into saved_hotels (property_id) values ($1)', [id]))).toMatchObject({ code: '23514' });
  });
});

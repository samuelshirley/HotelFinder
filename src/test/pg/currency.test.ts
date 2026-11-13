import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { resetDb, seedUser } from './harness';
import { RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { dispatchActions } from '@/server/dispatch';
import { runFinder } from '@/server/finder';
import { hotelRates } from '@/server/hotelRates';
import { addStay, createSession, getSession, getStay, updateSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const LATER = (minutes: number) => new Date(RECORDED_AT.getTime() + minutes * 60_000);

/** A member's Porto search (members are quoted net, the margin the USD recording was made at). */
async function porto() {
  const session = await createSession({ userId: (await seedUser()).id });
  await updateSession(session.id, { guestNationality: 'ES', priorities: ['cheapest'] });
  const stay = await addStay(session.id, { destinationText: 'Porto', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', checkIn: '2026-12-11', checkOut: '2026-12-13', priceCapMinor: 20000 });
  return { sessionId: session.id, stayId: stay.id };
}

describe('the currency picker', () => {
  it('a new currency is a new search in that currency: the supplier prices it, every offer on the list is in it, nothing is converted', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: RECORDED_AT });
    expect(searches[0].currency).toBe('EUR');
    const euros = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(euros.every((r) => r.offer?.currency === 'EUR')).toBe(true);

    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    const changed = await dispatchActions({ session, stay, actions: [{ type: 'set_currency', code: 'USD' }], supplier, now: LATER(1), today: '2026-11-11' });

    expect(changed.effect).toBe('refetch');
    expect(changed.finder).toMatchObject({ kind: 'ok', fetched: true });
    expect(searches).toHaveLength(2);
    expect(searches[1].currency).toBe('USD');
    expect((await getSession(ids.sessionId))!.currency).toBe('USD');

    const dollars = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(dollars.length).toBeGreaterThan(0);
    expect(dollars.every((r) => r.offer?.currency === 'USD')).toBe(true);
    // The supplier's own USD prices, not a euro price times a rate: the same hotel is quoted differently.
    const yotelEur = euros.find((r) => r.property.name === 'YOTEL Porto')!.offer!.totalMinor;
    const yotelUsd = dollars.find((r) => r.property.name === 'YOTEL Porto')?.offer?.totalMinor;
    expect(yotelUsd).toBeDefined();
    expect(yotelUsd).not.toBe(yotelEur);

    const view = await buildSessionView((await getSession(ids.sessionId))!);
    expect(view.session.currency).toBe('USD');
    expect(view.shortlist.every((r) => r.offer === null || r.offer.currency === 'USD')).toBe(true);
  });

  it('the price cap, which was in euros, is removed rather than converted', async () => {
    const ids = await porto();
    const { supplier } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: RECORDED_AT });
    await dispatchActions({ session: (await getSession(ids.sessionId))!, stay: (await getStay(ids.stayId, ids.sessionId))!, actions: [{ type: 'set_currency', code: 'USD' }], supplier, now: LATER(1), today: '2026-11-11' });
    expect((await getStay(ids.stayId, ids.sessionId))!.priceCapMinor).toBeNull();
  });

  it('the same currency again changes nothing and searches nothing', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: RECORDED_AT });
    const same = await dispatchActions({ session: (await getSession(ids.sessionId))!, stay: (await getStay(ids.stayId, ids.sessionId))!, actions: [{ type: 'set_currency', code: 'EUR' }], supplier, now: LATER(1), today: '2026-11-11' });
    expect(same.results).toEqual([{ action: { type: 'set_currency', code: 'EUR' }, ok: false, rejection: 'no_change' }]);
    expect(same.finder).toBeNull();
    expect(searches).toHaveLength(1);
    expect((await getStay(ids.stayId, ids.sessionId))!.priceCapMinor).toBe(20000);
  });

  it("a hotel's rooms and rates held in the old currency are fetched again in the new one", async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: RECORDED_AT });
    const hotel = (await listShortlist(ids.sessionId, ids.stayId, 'member'))[0].property.id;
    const inEuros = await hotelRates({ session: (await getSession(ids.sessionId))!, stay: (await getStay(ids.stayId, ids.sessionId))!, propertyId: hotel, supplier, now: LATER(1) });
    expect(inEuros.ok && inEuros.offers.every((o) => o.currency === 'EUR')).toBe(true);

    await dispatchActions({ session: (await getSession(ids.sessionId))!, stay: (await getStay(ids.stayId, ids.sessionId))!, actions: [{ type: 'set_currency', code: 'USD' }], supplier, now: LATER(2), today: '2026-11-11' });
    const before = searches.length;
    const inDollars = await hotelRates({ session: (await getSession(ids.sessionId))!, stay: (await getStay(ids.stayId, ids.sessionId))!, propertyId: hotel, supplier, now: LATER(3) });
    expect(inDollars).toMatchObject({ ok: true, fetched: true });
    expect(searches).toHaveLength(before + 1);
    expect(searches.at(-1)!.currency).toBe('USD');
    expect(inDollars.ok && inDollars.offers.length > 0 && inDollars.offers.every((o) => o.currency === 'USD')).toBe(true);
  });
});

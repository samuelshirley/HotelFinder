import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb, seedUser } from './harness';
import { runFinder, splitParty } from '@/server/finder';
import { addStay, adoptAnonymousSessions, createSession, updateSession, updateStay } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';

beforeEach(resetDb);

const NOW = new Date('2026-11-11T12:00:00Z');
const LATER = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
import { DOWN, recordedSupplier } from './recordedSupplier';

async function porto(owner: 'member' | 'anonymous' = 'member') {
  const session =
    owner === 'member' ? await createSession({ userId: (await seedUser()).id }) : await createSession({ anonId: 'anon-1' });
  await updateSession(session.id, { guestNationality: 'ES', priority: 'cheapest' });
  const stay = await addStay(session.id, {
    destinationText: 'Porto',
    placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY',
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
  });
  return { sessionId: session.id, stayId: stay.id };
}

const names = async (ids: { sessionId: string; stayId: string }, audience: 'public' | 'member' = 'member') =>
  (await listShortlist(ids.sessionId, ids.stayId, audience)).map((r) => r.property.name);

describe('the stay finder', () => {
  it('fetches once, stores offers and properties, and shortlists five with reasons', async () => {
    const ids = await porto();
    const { supplier, searches, facts } = recordedSupplier();
    const outcome = await runFinder({ ...ids, supplier, now: NOW });

    expect(outcome).toEqual({
      kind: 'ok',
      fetched: true,
      shortlisted: 5,
      eligible: 20,
      rejected: { over_price_cap: 0, missing_must_have: 0, below_public_price: 0, excluded_by_user: 0 },
      uncheckable: 0,
      distanceFrom: 'search_centre',
      amenityFactsMissing: false,
    });
    expect(searches).toHaveLength(1);
    expect(facts()).toBe(1);
    expect(searches[0]).toMatchObject({
      where: { placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY' },
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      occupancies: [{ adults: 2, childrenAges: [] }],
      currency: 'EUR',
      guestNationality: 'ES',
      marginPct: 3,
    });
    expect(await rawQuery('select 1 from properties')).toHaveLength(20);
    expect(await rawQuery('select 1 from offers')).toHaveLength(20);

    const list = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(list.map((r) => r.property.name)).toEqual([
      'YOTEL Porto',
      'Porto Palácio Hotel by The Editory',
      'Mercure Porto Centro Santa Catarina',
      'Hotel Carris Porto Ribeira',
      'NEYA Porto Hotel',
    ]);
    expect(list[0].entry.reason).toMatchObject({ kind: 'cheapest_meeting_all_musts', per_night_minor: 5534 });
    expect(list[0].offer).toMatchObject({ totalMinor: 11068, audience: 'member', payAtPropertyMinor: expect.any(Number) });
    expect(list[1].entry.reason).toMatchObject({ kind: 'runner_up', price_delta_minor: 989 });
  });

  it('a refinement re-ranks what is held and makes no supplier call', async () => {
    const ids = await porto();
    const { supplier, searches, facts } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });

    await updateStay(ids.stayId, ids.sessionId, { mustHaves: ['pets_allowed'] });
    const outcome = await runFinder({ ...ids, supplier, now: LATER(5) });
    expect(outcome).toMatchObject({ kind: 'ok', fetched: false, eligible: 7 });
    expect((await names(ids))[0]).toBe('Mercure Porto Centro Aliados');

    await updateSession(ids.sessionId, { priority: 'nicest' });
    await updateStay(ids.stayId, ids.sessionId, { mustHaves: [] });
    await runFinder({ ...ids, supplier, now: LATER(6) });
    expect((await names(ids))[0]).toBe('ICON Duplo Ribeira');

    expect(searches).toHaveLength(1);
    expect(facts()).toBe(1);
    expect(await rawQuery('select 1 from offers')).toHaveLength(20);
  });

  it('fetches again once the held rates have expired, and when told to refresh', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    await runFinder({ ...ids, supplier, now: LATER(14) });
    expect(searches).toHaveLength(1);
    await runFinder({ ...ids, supplier, now: LATER(16) });
    expect(searches).toHaveLength(2);
    await runFinder({ ...ids, supplier, now: LATER(17), refresh: true });
    expect(searches).toHaveLength(3);
  });

  it('an anonymous visitor is quoted the public margin and never a price under the public price', async () => {
    const ids = await porto('anonymous');
    const { supplier, searches } = recordedSupplier();
    const outcome = await runFinder({ ...ids, supplier, now: NOW });
    expect(searches[0].marginPct).toBe(15);
    expect(outcome).toMatchObject({ kind: 'ok', eligible: 18, rejected: { below_public_price: 2 } });
    const list = await listShortlist(ids.sessionId, ids.stayId, 'public');
    expect(list).toHaveLength(5);
    for (const row of list) {
      expect(row.offer?.audience).toBe('public');
      if (row.offer?.suggestedSellingMinor != null) expect(row.offer.totalMinor).toBeGreaterThanOrEqual(row.offer.suggestedSellingMinor);
    }
  });

  it('signing in mid-search fetches member prices; the public quotes are not what a member is ranked on', async () => {
    const ids = await porto('anonymous');
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    expect((await listShortlist(ids.sessionId, ids.stayId, 'public'))[0].offer?.totalMinor).toBe(12793);

    const user = await seedUser();
    await adoptAnonymousSessions('anon-1', user.id);
    const outcome = await runFinder({ ...ids, supplier, now: LATER(2) });

    expect(outcome).toMatchObject({ kind: 'ok', fetched: true, eligible: 20 });
    expect(searches.map((r) => r.marginPct)).toEqual([15, 3]);
    const list = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(list.map((r) => r.offer?.audience)).toEqual(['member', 'member', 'member', 'member', 'member']);
    expect(list[0]).toMatchObject({ property: { name: 'YOTEL Porto' }, offer: { totalMinor: 11068 } });
  });

  it('margins are settings, not constants', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW, env: { MEMBER_MARGIN_PCT: '1.5' } });
    expect(searches[0].marginPct).toBe(1.5);
    expect(await rawQuery<{ margin_pct: string }>('select distinct margin_pct from offers')).toEqual([{ margin_pct: '1.50' }]);
  });

  it('a hotel the user rejected stays out', async () => {
    const ids = await porto();
    const { supplier } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    const [first] = await listShortlist(ids.sessionId, ids.stayId, 'member');
    await updateStay(ids.stayId, ids.sessionId, { excludedPropertyIds: [first.property.id] });
    const outcome = await runFinder({ ...ids, supplier, now: LATER(1) });
    expect(outcome).toMatchObject({ kind: 'ok', rejected: { excluded_by_user: 1 } });
    expect(await names(ids)).not.toContain('YOTEL Porto');
    expect((await names(ids))[0]).toBe('Porto Palácio Hotel by The Editory');
  });

  it('a supplier failure is reported and nothing is stored', async () => {
    const ids = await porto();
    const { supplier } = recordedSupplier({ search: 'fail' });
    expect(await runFinder({ ...ids, supplier, now: NOW })).toEqual({ kind: 'supplier_error', error: DOWN });
    expect(await rawQuery('select 1 from offers')).toHaveLength(0);
    expect(await names(ids)).toEqual([]);
  });

  it('"no availability" is never cached: the next run asks again', async () => {
    const ids = await porto();
    const empty = recordedSupplier({ search: 'empty' });
    expect(await runFinder({ ...ids, supplier: empty.supplier, now: NOW })).toEqual({ kind: 'no_availability' });
    expect(await runFinder({ ...ids, supplier: empty.supplier, now: LATER(1) })).toEqual({ kind: 'no_availability' });
    expect(empty.searches).toHaveLength(2);
    const ok = recordedSupplier();
    expect(await runFinder({ ...ids, supplier: ok.supplier, now: LATER(2) })).toMatchObject({ kind: 'ok', fetched: true });
  });

  it('without amenity facts a must-have cannot be met, and the outcome says the facts were missing', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { mustHaves: ['parking'] });
    const { supplier } = recordedSupplier({ facts: 'fail' });
    const outcome = await runFinder({ ...ids, supplier, now: NOW });
    expect(outcome).toMatchObject({ kind: 'ok', shortlisted: 0, eligible: 0, uncheckable: 20, amenityFactsMissing: true });
  });

  it('asks for what it needs before searching', async () => {
    const session = await createSession({ anonId: 'a' });
    const stay = await addStay(session.id, { destinationText: 'Porto', checkIn: '2026-12-11', checkOut: '2026-12-13' });
    const { supplier, searches } = recordedSupplier();
    expect(await runFinder({ sessionId: session.id, stayId: stay.id, supplier, now: NOW })).toEqual({ kind: 'needs_place' });
    await updateStay(stay.id, session.id, { placeId: 'place-1' });
    expect(await runFinder({ sessionId: session.id, stayId: stay.id, supplier, now: NOW })).toEqual({ kind: 'needs_nationality' });
    expect(await runFinder({ sessionId: session.id, stayId: 'c0000000-0000-4000-8000-000000000000', supplier, now: NOW })).toEqual({ kind: 'not_found' });
    expect(searches).toHaveLength(0);
  });

  it('a party of four in two rooms with two children is asked for as two rooms', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 4, childrenAges: [4, 9], rooms: 2 });
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    expect(searches[0].occupancies).toEqual([
      { adults: 2, childrenAges: [4] },
      { adults: 2, childrenAges: [9] },
    ]);
  });
});

describe('splitParty', () => {
  it('never makes a room without an adult', () => {
    expect(splitParty(1, [], 3)).toEqual([{ adults: 1, childrenAges: [] }]);
    expect(splitParty(3, [5], 2)).toEqual([
      { adults: 2, childrenAges: [5] },
      { adults: 1, childrenAges: [] },
    ]);
    expect(splitParty(2, [], 1)).toEqual([{ adults: 2, childrenAges: [] }]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb, seedUser } from './harness';
import { runFinder, splitParty } from '@/server/finder';
import { dispatchActions } from '@/server/dispatch';
import { addStay, adoptAnonymousSessions, createSession, getSession, getStay, updateSession, updateStay } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizeRates } from '@/server/supplier/liteapi/normalize';
import { ratesResponse } from '@/server/supplier/liteapi/schemas';
import type { SearchRequest } from '@/server/supplier/types';

beforeEach(resetDb);

const NOW = new Date('2026-11-11T12:00:00Z');
const LATER = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
import { DOWN, PLACE_IDS, recordedSupplier } from './recordedSupplier';

async function porto(owner: 'member' | 'anonymous' = 'member') {
  const session =
    owner === 'member' ? await createSession({ userId: (await seedUser()).id }) : await createSession({ anonId: 'anon-1' });
  await updateSession(session.id, { guestNationality: 'ES', priorities: ['cheapest'] });
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
      nearMisses: 0,
      eligible: 20,
      rejected: { over_price_cap: 0, missing_must_have: 0, below_public_price: 0, excluded_by_user: 0 },
      uncheckable: 0,
      distanceFrom: 'search_centre',
      distanceLabel: null,
      widened: false,
      amenityFactsMissing: false,
      splits: 1,
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

    await updateSession(ids.sessionId, { priorities: ['nicest'] });
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

  it('fewer than five fit: the list is filled to five with the closest misses, each saying what it misses', async () => {
    const ids = await porto('anonymous');
    await updateStay(ids.stayId, ids.sessionId, { priceCapMinor: 6500 });
    const outcome = await runFinder({ ...ids, supplier: recordedSupplier().supplier, now: NOW });
    expect(outcome).toMatchObject({ kind: 'ok', shortlisted: 1, nearMisses: 4, eligible: 1 });
    const list = await listShortlist(ids.sessionId, ids.stayId, 'public');
    expect(list.map((r) => r.entry.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(list[0].entry.reason?.kind).toBe('cheapest_meeting_all_musts');
    for (const row of list.slice(1)) {
      expect(row.entry.reason).toMatchObject({ kind: 'near_miss', misses: [{ kind: 'over_price_cap' }] });
      // The miss is true, and its number is the real distance over the cap.
      const perNight = Math.ceil(row.offer!.totalMinor / 2);
      expect(perNight).toBeGreaterThan(6500);
      expect((row.entry.reason as unknown as { misses: Array<{ over_by_minor: number }> }).misses[0].over_by_minor).toBe(perNight - 6500);
    }
  });

  it('nothing fits: five closest misses are still listed', async () => {
    const ids = await porto('anonymous');
    await updateStay(ids.stayId, ids.sessionId, { priceCapMinor: 1000 });
    const outcome = await runFinder({ ...ids, supplier: recordedSupplier().supplier, now: NOW });
    expect(outcome).toMatchObject({ kind: 'ok', shortlisted: 0, nearMisses: 5, eligible: 0 });
    expect(await listShortlist(ids.sessionId, ids.stayId, 'public')).toHaveLength(5);
  });

  it('a near-miss whose rate is a member price holds no offer and no number from one', async () => {
    const ids = await porto('anonymous');
    await updateStay(ids.stayId, ids.sessionId, { priceCapMinor: 7000 });
    await runFinder({ ...ids, supplier: recordedSupplier().supplier, now: NOW });
    const list = await listShortlist(ids.sessionId, ids.stayId, 'public');
    const member = list.filter((r) => (r.entry.reason as { misses?: Array<{ kind: string }> } | null)?.misses?.some((m) => m.kind === 'member_price'));
    expect(member.length).toBeGreaterThan(0);
    const hidden = await rawQuery<{ total_minor: number }>(
      `select total_minor from offers where session_id = $1 and property_id = any($2) and total_minor < suggested_selling_minor`,
      [ids.sessionId, member.map((r) => r.property.id)],
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const row of member) {
      expect(row.offer).toBeNull();
      expect(row.entry.offerId).toBeNull();
      expect(row.entry.reason).not.toHaveProperty('per_night_minor');
      const json = JSON.stringify(row);
      for (const { total_minor } of hidden) {
        expect(json).not.toContain(String(total_minor));
        expect(json).not.toContain(String(Math.ceil(total_minor / 2)));
      }
    }
  });

  it('the schema refuses a finder row without an offer unless it is a member-price near-miss', async () => {
    const ids = await porto('anonymous');
    await runFinder({ ...ids, supplier: recordedSupplier().supplier, now: NOW });
    const [{ property_id }] = await rawQuery<{ property_id: string }>(`select property_id from shortlist_entries where session_id = $1 limit 1`, [ids.sessionId]);
    const insert = (reason: unknown) =>
      rawQuery(`insert into shortlist_entries (session_id, stay_id, property_id, rank, source, reason) values ($1, $2, $3, 99, 'finder', $4)`, [
        ids.sessionId,
        ids.stayId,
        property_id,
        JSON.stringify(reason),
      ]);
    await expect(insert({ kind: 'near_miss', misses: [{ kind: 'over_price_cap', over_by_minor: 100 }] })).rejects.toThrow(/shortlist_finder_rows_sourced/);
    await expect(insert({ kind: 'cheapest_meeting_all_musts' })).rejects.toThrow(/shortlist_finder_rows_sourced/);
    await expect(insert({ kind: 'near_miss', misses: [{ kind: 'member_price' }] })).resolves.toBeDefined();
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

describe('room splits: the rooms nobody fixed', () => {
  // The recordings answer by the occupancies asked (recordedSupplier RECORDED_PARTIES).
  const raw = (name: string) =>
    normalizeRates(ratesResponse.parse(fixture(name)), 15, NOW).offers.map((o) => ({ hotel: o.supplierHotelId, allIn: o.total.amountMinor + o.payAtProperty.amountMinor, rooms: o.rooms.length }));

  it('four adults: one room and two rooms are both priced, side by side, and each hotel is shown at its cheaper combination', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 4, childrenAges: [], rooms: null });
    const { supplier, searches, facts } = recordedSupplier();
    const outcome = await runFinder({ ...ids, supplier, now: NOW });

    expect(outcome).toMatchObject({ kind: 'ok', fetched: true, shortlisted: 5, splits: 2 });
    expect(searches.map((s) => s.occupancies)).toEqual([
      [{ adults: 4, childrenAges: [] }],
      [{ adults: 2, childrenAges: [] }, { adults: 2, childrenAges: [] }],
    ]);
    expect(facts()).toBe(1); // amenities once, for every hotel either split found
    // The two-room search found all 20; the one-room search 6 of them.
    expect(await rawQuery('select 1 from properties')).toHaveLength(20);

    // The oracle, from the raw recordings: each hotel's lowest all-in price over both splits.
    const all = [...raw('rates-four-adults-one-room'), ...raw('rates-four-adults-two-rooms')];
    const best = (hotel: string) => Math.min(...all.filter((o) => o.hotel === hotel).map((o) => o.allIn));
    const list = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(list).toHaveLength(5);
    for (const row of list.filter((r) => r.entry.source === 'finder' && r.offer)) {
      expect(row.offer!.totalMinor + row.offer!.payAtPropertyMinor).toBe(best(row.property.supplierHotelId));
      const rooms = row.offer!.rooms!;
      // The card says what the price is for, from the rooms the supplier priced.
      expect(row.offer!.roomName).toEqual(rooms.length === 1 ? rooms[0].name : expect.stringMatching(/^2 rooms: /));
    }
    // "cheapest" is the priority: the cheapest hotel over both splits is first.
    expect(list[0].offer!.totalMinor + list[0].offer!.payAtPropertyMinor).toBe(Math.min(...all.map((o) => o.allIn)));
  });

  it('rooms the user fixed: one search, for exactly those rooms', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 4, childrenAges: [], rooms: 1 });
    const { supplier, searches } = recordedSupplier();
    expect(await runFinder({ ...ids, supplier, now: NOW })).toMatchObject({ kind: 'ok', splits: 1 });
    expect(searches.map((s) => s.occupancies)).toEqual([[{ adults: 4, childrenAges: [] }]]);
    const list = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(list.filter((r) => r.offer).every((r) => r.offer!.rooms!.length === 1)).toBe(true);
  });

  it('a couple is one room and one search, as before', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    expect((await getStay(ids.stayId, ids.sessionId))!.rooms).toBeNull();
    expect(searches.map((s) => s.occupancies)).toEqual([[{ adults: 2, childrenAges: [] }]]);
  });

  it('one split failing still ranks what the other found; all failing is the supplier error', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 4, childrenAges: [], rooms: null });
    const recorded = recordedSupplier();
    const oneRoomDown = { ...recorded.supplier, searchAvailability: async (r: SearchRequest) => (r.occupancies.length === 1 ? { ok: false as const, error: DOWN } : recorded.supplier.searchAvailability(r)) };
    expect(await runFinder({ ...ids, supplier: oneRoomDown, now: NOW })).toMatchObject({ kind: 'ok', shortlisted: 5, splits: 2 });
    const list = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(list.filter((r) => r.offer).every((r) => r.offer!.rooms!.length === 2)).toBe(true);

    const down = recordedSupplier({ search: 'fail' });
    expect(await runFinder({ ...ids, supplier: down.supplier, now: LATER(1), refresh: true })).toEqual({ kind: 'supplier_error', error: DOWN });
    expect(down.searches).toHaveLength(2);
  });

  it('a family of four: one room and two (an adult and a child in each)', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 2, childrenAges: [4, 9], rooms: null });
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    expect(searches.map((s) => s.occupancies)).toEqual([
      [{ adults: 2, childrenAges: [4, 9] }],
      [{ adults: 1, childrenAges: [4] }, { adults: 1, childrenAges: [9] }],
    ]);
    const all = [...raw('rates-family-one-room'), ...raw('rates-family-two-rooms-split')];
    for (const row of (await listShortlist(ids.sessionId, ids.stayId, 'member')).filter((r) => r.offer)) {
      expect(row.offer!.totalMinor + row.offer!.payAtPropertyMinor).toBe(Math.min(...all.filter((o) => o.hotel === row.property.supplierHotelId).map((o) => o.allIn)));
    }
  });

  it('a refinement re-ranks the held combinations with no supplier call', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { adults: 4, childrenAges: [], rooms: null });
    const { supplier, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    await updateSession(ids.sessionId, { priorities: ['nicest'] });
    expect(await runFinder({ ...ids, supplier, now: LATER(1) })).toMatchObject({ kind: 'ok', fetched: false, splits: 0 });
    expect(searches).toHaveLength(2);
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

describe('a new search replaces the old one', () => {
  it('after a refetch, only offers from the new search are ranked, never the old search\'s prices', async () => {
    const ids = await porto();
    const first = recordedSupplier();
    await runFinder({ ...ids, supplier: first.supplier, now: NOW });
    const before = await listShortlist(ids.sessionId, ids.stayId, 'member');

    // The same hotels, dearer this time (the +15% recording): new dates, say.
    const dearer = recordedSupplier();
    const supplier = { ...dearer.supplier, searchAvailability: (r: Parameters<typeof dearer.supplier.searchAvailability>[0]) => dearer.supplier.searchAvailability({ ...r, marginPct: 15 }) };
    await runFinder({ ...ids, supplier, now: LATER(1), refresh: true });
    const after = await listShortlist(ids.sessionId, ids.stayId, 'member');

    expect(after[0].offer!.fetchedAt.getTime()).toBe(LATER(1).getTime());
    expect(after.every((r) => r.offer!.fetchedAt.getTime() === LATER(1).getTime())).toBe(true);
    expect(after[0].offer!.totalMinor).toBeGreaterThan(before[0].offer!.totalMinor);

    // And a re-rank later still sees only the newest search.
    await runFinder({ ...ids, supplier, now: LATER(2) });
    const reranked = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(reranked.every((r) => r.offer!.fetchedAt.getTime() === LATER(1).getTime())).toBe(true);
  });
});

describe('where to search, and where "close" is from', () => {
  async function at(place: 'opo' | 'porto', near: { placeId: string; label: string; latitude: number; longitude: number } | null = null) {
    const session = await createSession({ userId: (await seedUser()).id });
    await updateSession(session.id, { guestNationality: 'ES', priorities: ['cheapest', 'closest'] });
    const opo = place === 'opo';
    const stay = await addStay(session.id, {
      destinationText: opo ? 'Porto Airport (OPO)' : 'Porto, Portugal',
      placeId: opo ? PLACE_IDS.opo : PLACE_IDS.porto,
      destLatitude: opo ? 41.2481 : 41.1579,
      destLongitude: opo ? -8.6814 : -8.6291,
      destKind: opo ? 'point' : 'area',
      destCountry: 'PT',
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      ...(near ? { latitude: near.latitude, longitude: near.longitude, nearPlaceId: near.placeId, nearLabel: near.label } : {}),
    });
    return { sessionId: session.id, stayId: stay.id };
  }

  it('an airport as the destination: a 5 km radius around it, and distance measured from it', async () => {
    const ids = await at('opo');
    const { supplier, searches } = recordedSupplier();
    const outcome = await runFinder({ ...ids, supplier, now: NOW });
    expect(searches).toHaveLength(1);
    expect(searches[0].where).toEqual({ latitude: 41.2481, longitude: -8.6814, radiusM: 5000 });
    expect(outcome).toMatchObject({ kind: 'ok', distanceFrom: 'destination', distanceLabel: 'Porto Airport (OPO)', widened: false });
    expect((await names(ids))[0]).toBe('Hotel Aeroporto');
  });

  it('fewer than ten hotels in the first radius: exactly one wider search, and the bigger answer is used', async () => {
    const ids = await at('opo');
    const { supplier, searches } = recordedSupplier();
    let call = 0;
    const thin = {
      ...supplier,
      async searchAvailability(r: Parameters<typeof supplier.searchAvailability>[0]) {
        const res = await supplier.searchAvailability(r);
        call += 1;
        // The first radius: keep 4 of the recorded hotels, as a sparse area would answer.
        if (call === 1 && res.ok) return { ok: true as const, value: { properties: res.value.properties.slice(0, 4), offers: res.value.offers.filter((o) => res.value.properties.slice(0, 4).some((p) => p.supplierHotelId === o.supplierHotelId)) } };
        return res;
      },
    };
    const outcome = await runFinder({ ...ids, supplier: thin, now: NOW });
    expect(searches.map((s) => (s.where as { radiusM: number }).radiusM)).toEqual([5000, 15000]);
    expect(outcome).toMatchObject({ kind: 'ok', widened: true, eligible: 20 });
  });

  it('a city: searched by its place id, distance from the middle of the hotels', async () => {
    const ids = await at('porto');
    const { supplier, searches } = recordedSupplier();
    expect(await runFinder({ ...ids, supplier, now: NOW })).toMatchObject({ kind: 'ok', distanceFrom: 'search_centre', distanceLabel: null });
    expect(searches[0].where).toEqual({ placeId: PLACE_IDS.porto });
  });

  it('a place the user named: a radius around it, and every reason says it', async () => {
    const ids = await at('porto', { placeId: 'x', label: 'Ribeira', latitude: 41.1408, longitude: -8.613 });
    const { supplier, searches } = recordedSupplier();
    expect(await runFinder({ ...ids, supplier, now: NOW })).toMatchObject({ kind: 'ok', distanceFrom: 'place', distanceLabel: 'Ribeira' });
    expect(searches[0].where).toEqual({ latitude: 41.1408, longitude: -8.613, radiusM: 5000 });
    const [top] = await listShortlist(ids.sessionId, ids.stayId, 'member');
    expect(top.entry.reason).toMatchObject({ kind: 'best_mix', to: 'place', to_label: 'Ribeira' });
  });
});

describe('dispatch looks places up; no producer can give a point', () => {
  it('set_near: the supplier\'s point for the id is stored, a new search runs around it, and clear_near goes back', async () => {
    const ids = await porto();
    const { supplier, placeLookups, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    const near = await dispatchActions({ session, stay, actions: [{ type: 'set_near', placeId: PLACE_IDS.vieilleVille }], supplier, now: LATER(1), today: '2026-11-11' });
    expect(placeLookups).toEqual([PLACE_IDS.vieilleVille]);
    expect(near.effect).toBe('refetch');
    // The porto() stay has no destination point, so there is nothing to call "too far" from.
    expect(near.results[0]).toMatchObject({ ok: true });
    const afterNear = (await getStay(ids.stayId, ids.sessionId))!;
    expect(afterNear).toMatchObject({ nearPlaceId: PLACE_IDS.vieilleVille, nearLabel: 'Vieille Ville' });
    expect(searches.at(-1)!.where).toMatchObject({ radiusM: 5000 });

    const cleared = await dispatchActions({ session: (await getSession(ids.sessionId))!, stay: afterNear, actions: [{ type: 'clear_near' }], supplier, now: LATER(2), today: '2026-11-11' });
    expect(cleared.effect).toBe('refetch');
    expect(await getStay(ids.stayId, ids.sessionId)).toMatchObject({ nearPlaceId: null, nearLabel: null, latitude: null });
  });

  it('set_near_point (the user\'s own map): no lookup, a new search around the point, and the view carries it as the map\'s anchor', async () => {
    const ids = await porto();
    const { supplier, placeLookups, searches } = recordedSupplier();
    await runFinder({ ...ids, supplier, now: NOW });
    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    const r = await dispatchActions({ session, stay, actions: [{ type: 'set_near_point', latitude: 41.1496, longitude: -8.6109 }], supplier, now: LATER(1), today: '2026-11-11' });
    expect(placeLookups).toEqual([]); // nothing to look up: the point is the user's
    expect(r.effect).toBe('refetch');
    expect(r.results[0]).toMatchObject({ ok: true, action: { type: 'set_near', near: { label: 'the spot on your map', latitude: 41.1496, longitude: -8.6109 } } });
    expect(searches.at(-1)!.where).toEqual({ latitude: 41.1496, longitude: -8.6109, radiusM: 5000 });
    expect(await getStay(ids.stayId, ids.sessionId)).toMatchObject({ nearPlaceId: 'map:41.1496,-8.6109', nearLabel: 'the spot on your map', latitude: 41.1496, longitude: -8.6109 });
    const { buildSessionView } = await import('@/server/view');
    const view = await buildSessionView((await getSession(ids.sessionId))!);
    expect(view.stay).toMatchObject({ nearIsNamed: true, anchor: { latitude: 41.1496, longitude: -8.6109, label: 'the spot on your map' } });
  });

  it('a place lookup that fails changes nothing and says so', async () => {
    const ids = await porto();
    const { supplier } = recordedSupplier({ place: 'fail' });
    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    const r = await dispatchActions({ session, stay, actions: [{ type: 'set_near', placeId: PLACE_IDS.vieilleVille }], supplier, now: NOW, today: '2026-11-11' });
    expect(r).toMatchObject({ effect: 'none', finder: null, results: [{ ok: false, rejection: 'place_unavailable' }] });
    expect(await getStay(ids.stayId, ids.sessionId)).toMatchObject({ nearPlaceId: null });
  });

  it('a place far from the destination is refused before anything is stored or searched', async () => {
    const ids = await porto();
    await updateStay(ids.stayId, ids.sessionId, { destLatitude: 41.1579, destLongitude: -8.6291, destKind: 'area' });
    const { supplier, searches } = recordedSupplier();
    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    const r = await dispatchActions({ session, stay, actions: [{ type: 'set_near', placeId: PLACE_IDS.vieilleVille }], supplier, now: NOW, today: '2026-11-11' });
    expect(r.results[0]).toMatchObject({ ok: false, rejection: 'near_too_far' });
    expect(searches).toHaveLength(0);
    expect(await getStay(ids.stayId, ids.sessionId)).toMatchObject({ nearPlaceId: null });
  });

  it('a user change of nationality is recorded as theirs and triggers a new search', async () => {
    const ids = await porto();
    const { supplier, searches } = recordedSupplier();
    const session = (await getSession(ids.sessionId))!;
    const stay = (await getStay(ids.stayId, ids.sessionId))!;
    await dispatchActions({ session, stay, actions: [{ type: 'set_nationality', code: 'US' }], supplier, now: NOW, today: '2026-11-11' });
    expect(await getSession(ids.sessionId)).toMatchObject({ guestNationality: 'US', nationalitySource: 'user' });
    expect(searches.at(-1)!.guestNationality).toBe('US');
  });
});

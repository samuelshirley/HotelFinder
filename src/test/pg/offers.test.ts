import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { pgError, resetDb, testDb } from './harness';
import { EXPIRES, FETCHED, seedOffer, seedProperty, seedSearch } from './fixtures';
import * as schema from '@/server/db/schema';
import { replaceFinderShortlist } from '@/server/repos/finderShortlist';
import { getOffer, listLiveOffers } from '@/server/repos/offers';
import { upsertProperty } from '@/server/repos/properties';
import { addUserNamedProperty, listShortlist, setExcluded } from '@/server/repos/shortlist';

beforeEach(resetDb);

async function world() {
  const { session, stay } = await seedSearch();
  const property = await seedProperty();
  const ids = { sessionId: session.id, stayId: stay.id, propertyId: property.id };
  return { session, stay, property, ids };
}

describe('properties', () => {
  it('upserts on the supplier id and keeps one row', async () => {
    const a = await upsertProperty({ supplier: 'liteapi', supplierHotelId: 'lp1', name: 'Old name' });
    const b = await upsertProperty({ supplier: 'liteapi', supplierHotelId: 'lp1', name: 'New name', petsAllowed: true });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ name: 'New name', petsAllowed: true });
  });
});

describe('offers', () => {
  it('round-trips money, expiry and the supplier id untouched', async () => {
    const { ids, session } = await world();
    const offer = await seedOffer(ids, { supplierOfferId: 'AwJ2MQAAAABq/opaque==' });
    const read = await getOffer(offer.id, session.id, 'public');
    expect(read).toMatchObject({
      supplierOfferId: 'AwJ2MQAAAABq/opaque==',
      totalMinor: 28129,
      payAtPropertyMinor: 1200,
      marginPct: '10.00',
      currency: 'EUR',
    });
    expect(read?.fetchedAt.toISOString()).toBe(FETCHED.toISOString());
    expect(read?.expiresAt.toISOString()).toBe(EXPIRES.toISOString());
  });

  it('a member offer is invisible to an anonymous session on every read', async () => {
    const { ids, session, stay } = await world();
    const pub = await seedOffer(ids);
    const member = await seedOffer(ids, { audience: 'member', marginPct: '1.00', totalMinor: 25874 });

    expect(await getOffer(member.id, session.id, 'public')).toBeNull();
    expect((await getOffer(member.id, session.id, 'member'))?.id).toBe(member.id);

    const before = new Date('2026-11-11T10:05:00Z');
    expect((await listLiveOffers(session.id, stay.id, 'public', before)).map((o) => o.id)).toEqual([pub.id]);
    expect((await listLiveOffers(session.id, stay.id, 'member', before)).map((o) => o.id).sort()).toEqual(
      [pub.id, member.id].sort(),
    );
  });

  it('an expired offer is not live, and an offer is not readable from another session', async () => {
    const { ids, session, stay } = await world();
    const offer = await seedOffer(ids);
    expect(await listLiveOffers(session.id, stay.id, 'member', EXPIRES)).toEqual([]);
    const other = await seedSearch({ anonId: 'anon-2' });
    expect(await getOffer(offer.id, other.session.id, 'member')).toBeNull();
  });

  it('refuses an offer that expires before it was fetched or has a negative total', async () => {
    const { ids } = await world();
    expect((await pgError(seedOffer(ids, { expiresAt: FETCHED }))).code).toBe('23514');
    expect((await pgError(seedOffer(ids, { totalMinor: -1 }))).code).toBe('23514');
  });
});

describe('shortlist', () => {
  it('the finder replaces its own rows and leaves user-named rows alone', async () => {
    const { ids, session, stay, property } = await world();
    const second = await seedProperty('lp6557699a', 'Second hotel');
    const o1 = await seedOffer(ids);
    const o2 = await seedOffer({ ...ids, propertyId: second.id }, { totalMinor: 23995 });
    const named = await seedProperty('lpnamed', 'Pestana Vintage');
    await addUserNamedProperty({ sessionId: session.id, stayId: stay.id, propertyId: named.id });

    await replaceFinderShortlist(session.id, stay.id, [
      { propertyId: property.id, offerId: o1.id, rank: 1, reason: { kind: 'closest_to_poi', walk_min: 6 } },
      { propertyId: second.id, offerId: o2.id, rank: 2, reason: { kind: 'cheapest_meeting_all_musts' } },
    ]);
    await replaceFinderShortlist(session.id, stay.id, [
      { propertyId: second.id, offerId: o2.id, rank: 1, reason: { kind: 'cheapest_meeting_all_musts' } },
    ]);

    const list = await listShortlist(session.id, stay.id, 'public');
    expect(list.map((r) => [r.entry.source, r.entry.rank, r.property.name, r.offer?.totalMinor ?? null])).toEqual([
      ['finder', 1, 'Second hotel', 23995],
      ['user_named', 1, 'Pestana Vintage', null],
    ]);
    expect(list[0].entry.reason).toEqual({ kind: 'cheapest_meeting_all_musts' });
  });

  it('a finder row without an offer or without a reason cannot exist', async () => {
    const { ids } = await world();
    const { db } = await testDb();
    const offer = await seedOffer(ids);
    const noOffer = await pgError(
      db.insert(schema.shortlistEntries).values({ ...ids, rank: 1, source: 'finder', reason: { kind: 'x' } }),
    );
    const noReason = await pgError(
      db.insert(schema.shortlistEntries).values({ ...ids, offerId: offer.id, rank: 1, source: 'finder' }),
    );
    expect(noOffer.code).toBe('23514');
    expect(noReason.code).toBe('23514');
  });

  it('user-named rows follow the ranked rows, in the order the user asked', async () => {
    const { ids, session, stay, property } = await world();
    const offer = await seedOffer(ids);
    const first = await seedProperty('lpa', 'Asked first');
    const second = await seedProperty('lpb', 'Asked second');
    const runnerUp = await seedProperty('lpc', 'Runner-up');
    const offer2 = await seedOffer({ ...ids, propertyId: runnerUp.id }, { totalMinor: 30000 });
    await addUserNamedProperty({ sessionId: session.id, stayId: stay.id, propertyId: first.id });
    await replaceFinderShortlist(session.id, stay.id, [
      { propertyId: property.id, offerId: offer.id, rank: 1, reason: { kind: 'cheapest_meeting_all_musts' } },
      { propertyId: runnerUp.id, offerId: offer2.id, rank: 2, reason: { kind: 'next_cheapest' } },
    ]);
    await addUserNamedProperty({ sessionId: session.id, stayId: stay.id, propertyId: second.id });
    const list = await listShortlist(session.id, stay.id, 'public');
    // Two finder rows and two user-named rows share ranks 1 and 2, so an
    // ordering by rank alone can never produce this sequence.
    expect(list.map((r) => [r.entry.source, r.entry.rank, r.property.name])).toEqual([
      ['finder', 1, 'PortoBay Flores'],
      ['finder', 2, 'Runner-up'],
      ['user_named', 1, 'Asked first'],
      ['user_named', 2, 'Asked second'],
    ]);
  });

  it('the agent path can only write user_named', async () => {
    const { session, stay, property } = await world();
    const entry = await addUserNamedProperty({ sessionId: session.id, stayId: stay.id, propertyId: property.id });
    expect(entry).toMatchObject({ source: 'user_named', offerId: null, reason: null });
    // @ts-expect-error source is not a parameter of the agent's path
    await addUserNamedProperty({ sessionId: session.id, stayId: stay.id, propertyId: property.id, source: 'finder' });
  });

  it('an entry whose offer is member-priced is left out for an anonymous session', async () => {
    const { ids, session, stay, property } = await world();
    const member = await seedOffer(ids, { audience: 'member', totalMinor: 25874 });
    await replaceFinderShortlist(session.id, stay.id, [
      { propertyId: property.id, offerId: member.id, rank: 1, reason: { kind: 'cheapest_meeting_all_musts' } },
    ]);
    expect(await listShortlist(session.id, stay.id, 'public')).toEqual([]);
    expect(await listShortlist(session.id, stay.id, 'member')).toHaveLength(1);
  });

  it('exclusion hides an entry and is scoped to the session', async () => {
    const { ids, session, stay, property } = await world();
    const offer = await seedOffer(ids);
    await replaceFinderShortlist(session.id, stay.id, [
      { propertyId: property.id, offerId: offer.id, rank: 1, reason: { kind: 'cheapest_meeting_all_musts' } },
    ]);
    const [row] = await listShortlist(session.id, stay.id, 'public');
    const other = await seedSearch({ anonId: 'anon-2' });
    expect(await setExcluded(row.entry.id, other.session.id, true)).toBe(false);
    expect(await setExcluded(row.entry.id, session.id, true)).toBe(true);
    expect(await listShortlist(session.id, stay.id, 'public')).toEqual([]);
  });
});

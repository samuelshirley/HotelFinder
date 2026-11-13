import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { resetDb, seedUser } from './harness';
import { missText, type ReasonLike } from '@/lib/reasonText';
import { describeChange } from '@/lib/replies';
import type { Action } from '@/lib/store/actions';
import { dispatchActions } from '@/server/dispatch';
import { runFinder } from '@/server/finder';
import { addStay, createSession, getSession, getStay, updateSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { buildSessionView } from '@/server/view';
import { recordedSupplier } from './recordedSupplier';

/**
 * The filters on real Postgres, over the recorded Porto search (20 hotels, all
 * "Hotels" in the supplier's type list, chains from its static list):
 * persisted on the stay, applied as a re-rank with no supplier call, and a
 * listing silent on the field shown as a miss that says so.
 */
beforeEach(resetDb);

const NOW = new Date('2026-11-11T12:00:00Z');
const LATER = new Date(NOW.getTime() + 60_000);

async function searched(over: Parameters<typeof recordedSupplier>[0] = {}) {
  const session = await createSession({ userId: (await seedUser()).id });
  await updateSession(session.id, { guestNationality: 'ES', priorities: ['cheapest'] });
  const stay = await addStay(session.id, { destinationText: 'Porto', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', checkIn: '2026-12-11', checkOut: '2026-12-13' });
  const recorded = recordedSupplier(over);
  await runFinder({ sessionId: session.id, stayId: stay.id, supplier: recorded.supplier, now: NOW });
  const apply = async (actions: Action[]) =>
    dispatchActions({ session: (await getSession(session.id))!, stay: (await getStay(stay.id, session.id))!, actions, supplier: recorded.supplier, now: LATER, today: '2026-11-11' });
  const list = () => listShortlist(session.id, stay.id, 'member');
  return { sessionId: session.id, stayId: stay.id, recorded, apply, list };
}

const reasonOf = (row: { entry: { reason: unknown } }) => row.entry.reason as ReasonLike & { misses?: unknown };

describe('filters on the recorded Porto search', () => {
  it('a star class is stored, re-ranks what is held without a supplier call, and only that class fits', async () => {
    const s = await searched();
    const before = s.recorded.searches.length;
    const out = await s.apply([{ type: 'set_min_stars', stars: 5 }]);
    expect(out.effect).toBe('rerank');
    expect(s.recorded.searches).toHaveLength(before);
    expect(await getStay(s.stayId, s.sessionId)).toMatchObject({ minStars: 5, minRating: null, propertyTypes: [], chains: [] });
    // 8 five-star hotels; 11 four-star; one, Hotel Spot Family Suites, lists 0 stars, which is no class at all.
    expect(out.finder).toMatchObject({ kind: 'ok', eligible: 8, shortlisted: 5, nearMisses: 0, filterUnknown: 1, rejected: { filtered_out: 12 } });
    for (const row of await s.list()) expect(row.property.stars).toBe(5);
    expect(describeChange(out.results, out.state, 'EUR', out.finder)).toBe('5 stars only. 8 of 20 hotels fit.');
  });

  it('a brand: the two Mercure hotels fit, and the misses under them say what they are or that the listing names none', async () => {
    const s = await searched();
    const out = await s.apply([{ type: 'set_chains', chains: ['Mercure'] }]);
    expect(out.finder).toMatchObject({ kind: 'ok', eligible: 2, shortlisted: 2, nearMisses: 3 });
    const list = await s.list();
    expect(list.slice(0, 2).map((r) => r.property.name).sort()).toEqual(['Mercure Porto Centro Aliados', 'Mercure Porto Centro Santa Catarina']);
    const misses = list.slice(2).map((r) => missText(reasonOf(r).misses, 'EUR'));
    expect(misses).toHaveLength(3);
    for (const m of misses) expect(m).toMatch(/^Misses: (it is .+|the listing names no brand)$/);
    // 6 of the 20 have "Not Available" as their chain: silent, not independent.
    expect(out.finder).toMatchObject({ filterUnknown: 6, rejected: { filtered_out: 18 } });
  });

  it('a kind the results do not hold: nothing fits, and five hotels are listed, each saying it is a hotel', async () => {
    const s = await searched();
    const out = await s.apply([{ type: 'set_property_types', types: ['apartment'] }]);
    expect(out.finder).toMatchObject({ kind: 'ok', eligible: 0, shortlisted: 0, nearMisses: 5, filterUnknown: 0, rejected: { filtered_out: 20 } });
    for (const row of await s.list()) expect(missText(reasonOf(row).misses, 'EUR')).toBe('Misses: it is a hotel');
    expect(describeChange(out.results, out.state, 'EUR', out.finder)).toBe(
      'Apartments only. None of 20 hotels fit: 20 miss a filter. The 5 closest misses are listed, each saying what it misses.',
    );
  });

  it('without the static facts, no hotel is dropped silently: each says the listing does not say', async () => {
    const s = await searched({ facts: 'fail' });
    const out = await s.apply([{ type: 'set_property_types', types: ['hotel'] }]);
    expect(out.finder).toMatchObject({ kind: 'ok', eligible: 0, nearMisses: 5, filterUnknown: 20 });
    for (const row of await s.list()) expect(missText(reasonOf(row).misses, 'EUR')).toBe('Misses: the listing does not say what kind of place it is');
    expect(describeChange(out.results, out.state, 'EUR', out.finder)).toContain('20 miss a filter (for 20 the listing does not say)');
  });

  it('a rating and stars together, then cleared: back to the search as it was', async () => {
    const s = await searched();
    const first = (await s.list()).map((r) => r.property.id);
    const narrowed = await s.apply([{ type: 'set_min_rating', rating: 9.5 }, { type: 'set_min_stars', stars: 4 }]);
    // Rated 9.5 or more: Torel Palace (9.8), Casa da Companhia (9.5), Se Catedral (9.8), ICON Duplo (9.8).
    expect(narrowed.finder).toMatchObject({ eligible: 4 });
    for (const row of (await s.list()).filter((r) => reasonOf(r).kind !== 'near_miss')) {
      expect(row.property.rating).toBeGreaterThanOrEqual(9.5);
      expect(row.property.stars).toBeGreaterThanOrEqual(4);
    }
    await s.apply([{ type: 'set_min_rating', rating: null }, { type: 'set_min_stars', stars: null }]);
    expect((await s.list()).map((r) => r.property.id)).toEqual(first);
  });

  it('the view carries the filters and offers only kinds and brands the held hotels list', async () => {
    const s = await searched();
    await s.apply([{ type: 'set_chains', chains: ['YOTEL'] }]);
    const view = await buildSessionView((await getSession(s.sessionId))!, LATER);
    expect(view.stay?.filters).toEqual({ minStars: null, minRating: null, propertyTypes: [], chains: ['YOTEL'] });
    const options = view.stay!.filterOptions;
    expect(options.propertyTypes).toEqual([{ type: 'hotel', count: 20 }]);
    expect(options.chains.slice(0, 3)).toEqual([
      { chain: 'Eurostars Hotels', count: 3 },
      { chain: 'Mercure', count: 2 },
      { chain: 'Porto Bay Hotels & Resorts', count: 2 },
    ]);
    expect(options.chains).toHaveLength(10);
    expect(options.silent).toEqual({ propertyType: 0, chain: 6 });
  });
});

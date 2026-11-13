import { describe, expect, it } from 'vitest';

import { filterMisses, rankStay, type Candidate } from '@/lib/finder/rank';
import { filterOptions, NO_FILTERS, stayFilters, type StayFilters } from '@/lib/filters';
import { missText } from '@/lib/reasonText';
import { describeChange, filtersLine, outcomeLine } from '@/lib/replies';
import { extractMinRating, extractMinStars, extractPropertyTypes } from '@/lib/router/slots';
import { actionSchema, type ResolvedAction } from '@/lib/store/actions';
import { fingerprint, reduce, type SearchState } from '@/lib/store/reduce';

/**
 * The filters beside the price cap and the must-haves (docs/finder.md,
 * "Filters"): star class, guest rating, kind of place, brand. The rule that
 * does not move: a hotel whose listing does not hold the field is never
 * dropped without a word. It misses the filter as "the listing does not say".
 */

const TODAY = '2026-11-13';
const state = (filters: Partial<StayFilters> = {}): SearchState => ({
  priorities: [],
  guestNationality: 'ES',
  stay: {
    destinationText: 'Porto',
    placeId: 'p',
    destPoint: null,
    destKind: null,
    destCountry: null,
    near: null,
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
    adults: 2,
    childrenAges: [],
    rooms: 1,
    priceCapMinor: null,
    mustHaves: [],
    filters: { ...NO_FILTERS, ...filters },
    excludedPropertyIds: [],
  },
});

let n = 0;
const hotel = (over: Partial<Candidate> = {}): Candidate => {
  n += 1;
  return {
    offerId: `o${String(n).padStart(3, '0')}`,
    propertyId: `p${n}`,
    name: `Hotel ${n}`,
    totalMinor: 20000 + n * 100,
    suggestedSellingMinor: null,
    location: { latitude: 41.15, longitude: -8.61 },
    rating: 8.5,
    reviewCount: 1000,
    stars: 4,
    amenities: [],
    refundable: true,
    boardName: 'Room Only',
    propertyType: 'hotel',
    chain: null,
    ...over,
  };
};
const rank = (candidates: Candidate[], filters: Partial<StayFilters>) =>
  rankStay({ candidates, checkIn: '2026-12-11', checkOut: '2026-12-13', priorities: ['cheapest'], mustHaves: [], priceCapMinor: null, near: null, audience: 'member', filters: { ...NO_FILTERS, ...filters } });

describe('the actions', () => {
  it('accept what a chip or a tool can send, and nothing else', () => {
    const ok = (a: unknown) => actionSchema.safeParse(a).success;
    expect(ok({ type: 'set_min_stars', stars: 4 })).toBe(true);
    expect(ok({ type: 'set_min_stars', stars: null })).toBe(true);
    expect(ok({ type: 'set_min_stars', stars: 6 })).toBe(false);
    expect(ok({ type: 'set_min_stars', stars: 3.5 })).toBe(false);
    expect(ok({ type: 'set_min_rating', rating: 8.5 })).toBe(true);
    expect(ok({ type: 'set_min_rating', rating: 8.3 })).toBe(false);
    expect(ok({ type: 'set_min_rating', rating: 11 })).toBe(false);
    expect(ok({ type: 'set_property_types', types: ['apartment', 'hostel'] })).toBe(true);
    expect(ok({ type: 'set_property_types', types: ['castle'] })).toBe(false);
    expect(ok({ type: 'set_property_types', types: ['hostel', 'hostel'] })).toBe(false);
    expect(ok({ type: 'set_chains', chains: ['Mercure'] })).toBe(true);
    expect(ok({ type: 'set_chains', chains: [''] })).toBe(false);
    expect(ok({ type: 'set_chains', chains: Array.from({ length: 11 }, (_, i) => `c${i}`) })).toBe(false);
    expect(ok({ type: 'set_min_stars', stars: 4, extra: 1 })).toBe(false);
  });
});

describe('the reducers', () => {
  it('each filter is a re-rank of what is held, never a new search', () => {
    for (const action of [
      { type: 'set_min_stars', stars: 4 },
      { type: 'set_min_rating', rating: 8 },
      { type: 'set_property_types', types: ['apartment'] },
      { type: 'set_chains', chains: ['Mercure'] },
    ] satisfies ResolvedAction[]) {
      const r = reduce(state(), action, TODAY);
      expect(r.ok && r.effect, action.type).toBe('rerank');
    }
  });

  it('the same value again is no change; null and [] clear it', () => {
    expect(reduce(state({ minStars: 4 }), { type: 'set_min_stars', stars: 4 }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    expect(reduce(state(), { type: 'set_min_rating', rating: null }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    const cleared = reduce(state({ minStars: 4, chains: ['Mercure'] }), { type: 'set_min_stars', stars: null }, TODAY);
    expect(cleared.ok && cleared.state.stay.filters).toEqual({ ...NO_FILTERS, chains: ['Mercure'] });
  });

  it('kinds are kept in one order and chains sorted, so the same set is the same search', () => {
    const a = reduce(state(), { type: 'set_property_types', types: ['hostel', 'apartment'] }, TODAY);
    expect(a.ok && a.state.stay.filters.propertyTypes).toEqual(['apartment', 'hostel']);
    expect(reduce(state({ propertyTypes: ['apartment', 'hostel'] }), { type: 'set_property_types', types: ['hostel', 'apartment'] }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    const c = reduce(state(), { type: 'set_chains', chains: ['YOTEL', 'Mercure'] }, TODAY);
    expect(c.ok && c.state.stay.filters.chains).toEqual(['Mercure', 'YOTEL']);
  });

  it('a filter is part of what a staged action was computed against', () => {
    expect(fingerprint(state({ minStars: 4 }))).not.toBe(fingerprint(state()));
    expect(fingerprint(state({ chains: ['Mercure'] }))).not.toBe(fingerprint(state()));
  });

  it('a stored row reads back as the same filters, unknown kinds dropped', () => {
    expect(stayFilters({ minStars: 4, minRating: null, propertyTypes: ['hostel', 'castle', 'apartment'], chains: ['YOTEL', 'Mercure'] })).toEqual({
      minStars: 4,
      minRating: null,
      propertyTypes: ['apartment', 'hostel'],
      chains: ['Mercure', 'YOTEL'],
    });
  });
});

describe('the finder rule', () => {
  it('nothing on the shortlist misses a filter', () => {
    const all = [
      hotel({ stars: 5, rating: 9.1, chain: 'Mercure' }),
      hotel({ stars: 3, rating: 9.4, chain: 'Mercure' }),
      hotel({ stars: 4, rating: 7.9, chain: 'YOTEL' }),
      hotel({ stars: 4, rating: 8.8, propertyType: 'apartment', chain: 'Mercure' }),
      hotel({ stars: 5, rating: 9.0, chain: 'Mercure' }),
      hotel({ stars: 4, rating: 8.0, chain: 'mercure' }),
    ];
    const f = { minStars: 4, minRating: 8, propertyTypes: ['hotel' as const], chains: ['Mercure'] };
    const r = rank(all, f);
    expect(r.shortlist.map((s) => s.candidate.propertyId)).toEqual([all[0].propertyId, all[4].propertyId, all[5].propertyId]);
    for (const s of r.shortlist) expect(filterMisses(s.candidate, { ...NO_FILTERS, ...f })).toEqual([]);
    expect(r.rejected.filtered_out).toBe(3);
  });

  it('5 means five only; 4 means four and up', () => {
    const [three, four, five] = [hotel({ stars: 3 }), hotel({ stars: 4 }), hotel({ stars: 5 })];
    expect(rank([three, four, five], { minStars: 5 }).shortlist.map((s) => s.candidate.stars)).toEqual([5]);
    expect(rank([three, four, five], { minStars: 4 }).shortlist.map((s) => s.candidate.stars)).toEqual([4, 5]);
  });

  it('a silent listing is a near miss that says so, never a silent drop', () => {
    const fits = hotel({ stars: 4 });
    const noStars = hotel({ stars: null });
    const zeroStars = hotel({ stars: 0 }); // the supplier's "not rated"
    const noType = hotel({ propertyType: null });
    const noChain = hotel({ chain: null });
    const r1 = rank([fits, noStars, zeroStars], { minStars: 4 });
    expect(r1.shortlist).toHaveLength(1);
    expect(r1.nearMisses.map((m) => m.misses)).toEqual([
      [{ kind: 'below_stars', min: 4, stars: null }],
      [{ kind: 'below_stars', min: 4, stars: null }],
    ]);
    expect(r1.filterUnknown).toBe(2);
    expect(missText(r1.nearMisses[0].misses, 'EUR')).toBe('Misses: the listing does not give a star class');

    const r2 = rank([noType], { propertyTypes: ['apartment'] });
    expect(missText(r2.nearMisses[0].misses, 'EUR')).toBe('Misses: the listing does not say what kind of place it is');
    const r3 = rank([noChain], { chains: ['Mercure'] });
    expect(missText(r3.nearMisses[0].misses, 'EUR')).toBe('Misses: the listing names no brand');
    const r4 = rank([hotel({ rating: null })], { minRating: 8 });
    expect(missText(r4.nearMisses[0].misses, 'EUR')).toBe('Misses: the listing does not give a guest rating');
  });

  it('a known value that misses says what it is', () => {
    const r = rank([hotel({ stars: 3, rating: 7.5, propertyType: 'hostel', chain: 'YOTEL' })], { minStars: 4, minRating: 8, propertyTypes: ['apartment', 'aparthotel'], chains: ['Mercure'] });
    expect(missText(r.nearMisses[0].misses, 'EUR')).toBe('Misses: 3 stars; rated 7.5; it is a hostel; it is YOTEL');
    expect(r.filterUnknown).toBe(0);
    const other = rank([hotel({ propertyType: 'other' })], { propertyTypes: ['apartment', 'hostel'] });
    expect(missText(other.nearMisses[0].misses, 'EUR')).toBe('Misses: not an apartment or a hostel');
    const apt = rank([hotel({ propertyType: 'apartment' })], { propertyTypes: ['hotel'] });
    expect(missText(apt.nearMisses[0].misses, 'EUR')).toBe('Misses: it is an apartment');
  });

  it('no filters: the same order as before filters existed', () => {
    const all = [hotel({ propertyType: null, chain: null, stars: null }), hotel(), hotel({ stars: 0 })];
    const without = rankStay({ candidates: all, checkIn: '2026-12-11', checkOut: '2026-12-13', priorities: ['cheapest'], mustHaves: [], priceCapMinor: null, near: null, audience: 'member' });
    const withNone = rank(all, {});
    expect(withNone.shortlist.map((s) => s.candidate.offerId)).toEqual(without.shortlist.map((s) => s.candidate.offerId));
    expect(withNone.nearMisses).toEqual([]);
  });
});

describe('what the app says', () => {
  it('each change in one line, and the whole set for "what is my search?"', () => {
    const s = state({ minStars: 4, propertyTypes: ['apartment', 'hostel'], chains: ['Mercure'] });
    const say = (a: Parameters<typeof describeChange>[0][number]['action']) => describeChange([{ action: a, ok: true }], s, 'EUR', null);
    expect(say({ type: 'set_min_stars', stars: 4 })).toBe('4 stars and up only.');
    expect(say({ type: 'set_min_stars', stars: 5 })).toBe('5 stars only.');
    expect(say({ type: 'set_min_stars', stars: null })).toBe('Any star class.');
    expect(say({ type: 'set_min_rating', rating: 8 })).toBe('Rated 8 and up only.');
    expect(say({ type: 'set_property_types', types: ['hostel', 'apartment'] })).toBe('Apartments or hostels only.');
    expect(say({ type: 'set_property_types', types: [] })).toBe('Any kind of place.');
    expect(say({ type: 'set_chains', chains: ['Mercure'] })).toBe('Mercure only.');
    expect(filtersLine(s.stay.filters)).toBe('Showing only 4 stars and up, apartments or hostels, from Mercure.');
    expect(filtersLine(NO_FILTERS)).toBeNull();
  });

  it('when nothing fits, how many a filter left out, and for how many the listing was silent', () => {
    const line = outcomeLine({ kind: 'ok', shortlisted: 0, nearMisses: 5, eligible: 0, rejected: { over_price_cap: 0, missing_must_have: 0, filtered_out: 20, below_public_price: 0, excluded_by_user: 0 }, uncheckable: 0, filterUnknown: 6, amenityFactsMissing: false });
    expect(line).toBe('None of 20 hotels fit: 20 miss a filter (for 6 the listing does not say). The 5 closest misses are listed, each saying what it misses.');
  });

  it('the editors offer only kinds and brands the held listings carry, and count the silent ones', () => {
    const o = filterOptions([
      { propertyType: 'hotel', chain: 'Mercure' },
      { propertyType: 'hotel', chain: 'Mercure' },
      { propertyType: 'apartment', chain: null },
      { propertyType: 'other', chain: 'YOTEL' },
      { propertyType: null, chain: null },
    ]);
    expect(o).toEqual({
      propertyTypes: [{ type: 'hotel', count: 2 }, { type: 'apartment', count: 1 }],
      chains: [{ chain: 'Mercure', count: 2 }, { chain: 'YOTEL', count: 1 }],
      silent: { propertyType: 1, chain: 2 },
    });
  });
});

describe('values read from a message (the filter intent)', () => {
  it.each([
    ['only 4 stars or more', 4],
    ['4+ stars please', 4],
    ['five-star only', 5],
    ['at least 3*', 3],
    ['make it 5 star hotels', 5],
    ['four star and up', 4],
  ])('stars: %s → %s', (m, v) => expect(extractMinStars(m)).toBe(v));

  it.each(['3 or 4 stars', 'a nice hotel', '4 stars, no wait, 5 stars', 'under 120 a night'])('stars: %s → nothing', (m) => expect(extractMinStars(m)).toBeNull());

  it.each([
    ['rated 8 or above', 8],
    ['a review score of 8.5+', 8.5],
    ['only places rated over 9', 9],
    ['rating 7 or better', 7],
    ['8/10 reviews or better', 8],
    ['rated 8,5 or more', 8.5],
  ])('rating: %s → %s', (m, v) => expect(extractMinRating(m)).toBe(v));

  it.each(['rated 8 or 9', 'something well rated', '4 stars or more', 'rated 8.3 or more', 'great reviews under 120 a night'])('rating: %s → nothing', (m) =>
    expect(extractMinRating(m)).toBeNull(),
  );

  it.each([
    ['apartments only', ['apartment']],
    ['a hostel or a guest house', ['hostel', 'guest_house']],
    ['an aparthotel', ['aparthotel']],
    ['just B&Bs', ['bed_and_breakfast']],
    ['hotels only please', ['hotel']],
    ['a villa or holiday home', ['holiday_home']],
  ])('kinds: %s → %j', (m, v) => expect(extractPropertyTypes(m)).toEqual(v));

  it.each(['a hotel, not an apartment', 'no hostels', 'somewhere nice', 'anything but a B&B'])('kinds: %s → nothing', (m) => expect(extractPropertyTypes(m)).toBeNull());
});

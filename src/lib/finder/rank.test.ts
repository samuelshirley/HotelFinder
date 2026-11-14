import { describe, expect, it } from 'vitest';

import { AMENITIES } from '@/lib/amenities';
import { haversineKm, medianPoint, nightsBetween } from './geo';
import { CANONICAL_PRIORITIES, CITY_BOUND_MIN_KM, cityBoundKm, dominates, meetsMustHave, MIN_SHOWN, rankStay, type Candidate, type PriorityKey } from './rank';

/** Every set of priorities: none, each alone, every pair, all three. */
const SUBSETS: PriorityKey[][] = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => CANONICAL_PRIORITIES.filter((_, i) => mask & (1 << i)));
const label = (set: readonly PriorityKey[]) => (set.length ? set.join('+') : 'none');

/** A small seeded PRNG so a failure can be replayed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCandidates(rand: () => number, n: number): Candidate[] {
  // Few distinct values per metric, so ties and dominated pairs are common.
  const pick = <T>(values: T[]) => values[Math.floor(rand() * values.length)];
  return Array.from({ length: n }, (_, i) => ({
    offerId: `o${i}`,
    propertyId: `p${i}`,
    name: `Hotel ${i}`,
    totalMinor: pick([8000, 10000, 10000, 12000, 15000, 20000]),
    suggestedSellingMinor: pick([null, 9000, 12000, 16000]),
    location: pick([null, { latitude: 41.14, longitude: -8.61 }, { latitude: 41.15, longitude: -8.62 }, { latitude: 41.16, longitude: -8.64 }]),
    rating: pick([null, 6.9, 7.5, 8.2, 8.2, 9.1]),
    reviewCount: pick([null, 10, 50, 400, 400, 3000]),
    stars: pick([null, 3, 4, 5]),
    amenities: pick([null, [], ['parking'], ['parking', 'pets_allowed'], [...AMENITIES]]) as Candidate['amenities'],
    refundable: rand() < 0.5,
    boardName: pick([null, 'Room Only', 'Breakfast Included']),
  }));
}

const base = { checkIn: '2026-12-11', checkOut: '2026-12-13', mustHaves: [], priceCapMinor: null, near: null, audience: 'member' as const };

describe('dominance: a hotel no worse on anything and better on something never ranks lower', () => {
  for (const priorities of SUBSETS) {
    it(`holds for priorities=${label(priorities)} over 400 random searches`, () => {
      const rand = mulberry32(20261111);
      let dominatedPairs = 0;
      for (let round = 0; round < 400; round++) {
        const candidates = randomCandidates(rand, 3 + Math.floor(rand() * 12));
        const near = rand() < 0.5 ? { point: { latitude: 41.145, longitude: -8.615 }, label: 'Here', from: 'place' as const } : null;
        const { ordered } = rankStay({ ...base, candidates, priorities, near });
        for (let i = 0; i < ordered.length; i++) {
          for (let j = i + 1; j < ordered.length; j++) {
            const upper = { ...ordered[i].candidate, km: kmOf(ordered[i]) };
            const lower = { ...ordered[j].candidate, km: kmOf(ordered[j]) };
            if (dominates(lower, upper)) {
              throw new Error(`round ${round}: ${lower.name} dominates ${upper.name} but ranks below it (priorities ${label(priorities)})`);
            }
            if (dominates(upper, lower)) dominatedPairs += 1;
          }
        }
      }
      expect(dominatedPairs).toBeGreaterThan(1000); // the property was actually exercised
    });
  }
  // Dominance is checked on the distance the user is shown (100 m steps), which is what the ranking uses.
  function kmOf(row: { km: number | null }) {
    return row.km;
  }
});

describe('ranking is a pure, total order', () => {
  it('the same candidates in any input order, and the priorities in any order, give the same ranking', () => {
    const rand = mulberry32(7);
    for (let round = 0; round < 100; round++) {
      const candidates = randomCandidates(rand, 10);
      const shuffled = [...candidates].sort(() => rand() - 0.5);
      for (const priorities of SUBSETS) {
        const a = rankStay({ ...base, candidates, priorities }).ordered.map((r) => r.candidate.offerId);
        const b = rankStay({ ...base, candidates: shuffled, priorities: [...priorities].reverse() }).ordered.map((r) => r.candidate.offerId);
        expect(b, label(priorities)).toEqual(a);
      }
    }
  });

  it('does not mutate its input', () => {
    const candidates = randomCandidates(mulberry32(3), 8);
    const before = JSON.stringify(candidates);
    rankStay({ ...base, candidates, priorities: ['cheapest'] });
    expect(JSON.stringify(candidates)).toBe(before);
  });
});

describe('hard constraints', () => {
  const hotel = (over: Partial<Candidate>): Candidate => ({
    offerId: 'o',
    propertyId: 'p',
    name: 'H',
    totalMinor: 20000,
    suggestedSellingMinor: null,
    location: null,
    rating: 8,
    reviewCount: 100,
    stars: 3,
    amenities: [],
    refundable: false,
    boardName: 'Room Only',
    ...over,
  });

  it('unknown amenities never satisfy a must-have', () => {
    expect(meetsMustHave(hotel({ amenities: null }), 'parking')).toBe(false);
    expect(meetsMustHave(hotel({ amenities: ['parking'] }), 'parking')).toBe(true);
    const result = rankStay({ ...base, candidates: [hotel({ amenities: null })], priorities: ['cheapest'], mustHaves: ['parking'] });
    expect(result).toMatchObject({ eligible: 0, uncheckable: 1, rejected: { missing_must_have: 1 } });
  });

  it('breakfast is read from the board, and "Room Only" is never breakfast', () => {
    expect(meetsMustHave(hotel({ boardName: 'Breakfast Included' }), 'breakfast_included')).toBe(true);
    expect(meetsMustHave(hotel({ boardName: 'Half Board' }), 'breakfast_included')).toBe(true);
    expect(meetsMustHave(hotel({ boardName: 'Room Only' }), 'breakfast_included')).toBe(false);
    expect(meetsMustHave(hotel({ boardName: null }), 'breakfast_included')).toBe(false);
    expect(meetsMustHave(hotel({ boardName: 'Room Only (breakfast available at a surcharge)' }), 'breakfast_included')).toBe(false);
  });

  it('the price cap is per night for the whole stay, rounded up', () => {
    const three = { ...base, checkOut: '2026-12-14' }; // 3 nights
    const c = hotel({ totalMinor: 30001 });
    expect(rankStay({ ...three, candidates: [c], priorities: ['cheapest'], priceCapMinor: 10000 }).eligible).toBe(0);
    expect(rankStay({ ...three, candidates: [c], priorities: ['cheapest'], priceCapMinor: 10001 }).shortlist[0].perNightMinor).toBe(10001);
  });

  it('a member may see a price under the public price; an anonymous visitor may not', () => {
    const c = hotel({ totalMinor: 10000, suggestedSellingMinor: 12000 });
    expect(rankStay({ ...base, candidates: [c], priorities: ['cheapest'] }).eligible).toBe(1);
    expect(rankStay({ ...base, candidates: [c], priorities: ['cheapest'], audience: 'public' })).toMatchObject({
      eligible: 0,
      rejected: { below_public_price: 1 },
    });
    const atPar = hotel({ totalMinor: 12000, suggestedSellingMinor: 12000 });
    expect(rankStay({ ...base, candidates: [atPar], priorities: ['cheapest'], audience: 'public' }).eligible).toBe(1);
  });

  it('a hotel the user rejected does not come back', () => {
    const a = hotel({ offerId: 'a', propertyId: 'pa', totalMinor: 100 });
    const b = hotel({ offerId: 'b', propertyId: 'pb', totalMinor: 200 });
    const result = rankStay({ ...base, candidates: [a, b], priorities: ['cheapest'], excludedPropertyIds: ['pa'] });
    expect(result.shortlist.map((r) => r.candidate.propertyId)).toEqual(['pb']);
    expect(result.rejected.excluded_by_user).toBe(1);
  });

  it('the shortlist is five by default and its size can be set', () => {
    const many = Array.from({ length: 9 }, (_, i) => hotel({ offerId: `o${i}`, propertyId: `p${i}`, totalMinor: 100 + i }));
    expect(rankStay({ ...base, candidates: many, priorities: ['cheapest'] }).shortlist).toHaveLength(5);
    expect(rankStay({ ...base, candidates: many, priorities: ['cheapest'], size: 3 }).shortlist).toHaveLength(3);
    expect(rankStay({ ...base, candidates: many, priorities: ['cheapest'] }).ordered).toHaveLength(9);
  });

  it('"nicest" breaks a rating tie by how many people rated, before price', () => {
    const fewReviewsCheaper = hotel({ offerId: 'f', propertyId: 'pf', totalMinor: 10000, rating: 9.5, reviewCount: 40 });
    const manyReviewsDearer = hotel({ offerId: 'm', propertyId: 'pm', totalMinor: 30000, rating: 9.5, reviewCount: 4000 });
    const result = rankStay({ ...base, candidates: [fewReviewsCheaper, manyReviewsDearer], priorities: ['nicest'] });
    expect(result.shortlist.map((r) => r.candidate.offerId)).toEqual(['m', 'f']);
  });
});

describe('combined priorities', () => {
  const at = (offerId: string, totalMinor: number, rating: number, km: number, reviewCount = 100): Candidate => ({
    offerId,
    propertyId: `p-${offerId}`,
    name: offerId,
    totalMinor,
    suggestedSellingMinor: null,
    // Due north of the target: 1 degree of latitude is ~111.2 km.
    location: { latitude: 41 + km / 111.195, longitude: -8 },
    rating,
    reviewCount,
    stars: 3,
    amenities: [],
    refundable: false,
    boardName: 'Room Only',
  });
  const near = { point: { latitude: 41, longitude: -8 }, label: 'the old town', from: 'place' as const };
  const order = (candidates: Candidate[], priorities: PriorityKey[]) =>
    rankStay({ ...base, candidates, priorities, near }).ordered.map((r) => r.candidate.offerId);

  // A cheap far hotel, a dear close hotel, and one in the middle on both.
  const cheapFar = at('cheapFar', 6000, 8.0, 5);
  const dearClose = at('dearClose', 30000, 8.0, 0.2);
  const middle = at('middle', 12000, 8.0, 1.5);
  const worse = at('worse', 20000, 8.0, 3);

  it('two priorities pick the hotel good at both, not the best at either', () => {
    expect(order([cheapFar, dearClose, middle, worse], ['cheapest'])[0]).toBe('cheapFar');
    expect(order([cheapFar, dearClose, middle, worse], ['closest'])[0]).toBe('dearClose');
    expect(order([cheapFar, dearClose, middle, worse], ['cheapest', 'closest'])[0]).toBe('middle');
  });

  it('an unselected metric carries no weight', () => {
    // On price + distance, A and B tie (A cheaper, B closer) and price breaks it.
    // B is far better rated: any weight on rating would put B first.
    const a = at('A', 9000, 5.0, 1.0);
    const b = at('B', 10000, 9.9, 0.5);
    const c = at('C', 11000, 7.0, 2.0);
    expect(order([a, b, c], ['cheapest', 'closest'])).toEqual(['A', 'B', 'C']);
  });

  it('adding a hotel that is worst on every metric never reorders the others', () => {
    const rand = mulberry32(99);
    for (let round = 0; round < 200; round++) {
      const candidates = randomCandidates(rand, 4 + Math.floor(rand() * 8)).map((c) => ({ ...c, location: c.location ?? { latitude: 41.14, longitude: -8.61 }, rating: c.rating ?? 7, reviewCount: c.reviewCount ?? 10 }));
      const worst: Candidate = { ...candidates[0], offerId: 'zz-worst', propertyId: 'zz', totalMinor: 99_999_999, location: { latitude: 60, longitude: 20 }, rating: 0, reviewCount: 0 };
      for (const priorities of SUBSETS.filter((s) => s.length > 1)) {
        const nearHere = { point: { latitude: 41.145, longitude: -8.615 }, label: null, from: 'place' as const };
        const before = rankStay({ ...base, candidates, priorities, near: nearHere }).ordered.map((r) => r.candidate.offerId);
        const after = rankStay({ ...base, candidates: [...candidates, worst], priorities, near: nearHere }).ordered.map((r) => r.candidate.offerId);
        expect(after.filter((id) => id !== 'zz-worst'), `round ${round} ${label(priorities)}`).toEqual(before);
        expect(after.at(-1)).toBe('zz-worst');
      }
    }
  });

  it('the top row says it is a mix, with ranks and never an amount', () => {
    const result = rankStay({ ...base, candidates: [cheapFar, dearClose, middle, worse], priorities: ['closest', 'cheapest'], near });
    expect(result.shortlist[0].reason).toEqual({
      kind: 'best_mix',
      of: ['cheapest', 'closest'],
      km: 1.5,
      to: 'place',
      to_label: 'the old town',
      rating: 8,
      reviews: 100,
      price_rank: 2,
      eligible: 4,
    });
    expect(result.shortlist[1].reason.kind).toBe('runner_up');
  });

  it('one priority keeps its single reason, and says where distance is from', () => {
    const result = rankStay({ ...base, candidates: [cheapFar, dearClose, middle, worse], priorities: ['closest'], near: { ...near, from: 'destination', label: 'Annecy centre' } });
    expect(result.shortlist[0].reason).toEqual({ kind: 'closest', km: 0.2, to: 'destination', to_label: 'Annecy centre' });
    expect(result).toMatchObject({ distanceFrom: 'destination', distanceLabel: 'Annecy centre' });
  });

  it('with no target known, distance falls back to the middle of the results and carries no label', () => {
    const result = rankStay({ ...base, candidates: [cheapFar, dearClose, middle, worse], priorities: ['closest'], near: null });
    expect(result).toMatchObject({ distanceFrom: 'search_centre', distanceLabel: null });
    expect(result.shortlist[0].reason).toMatchObject({ kind: 'closest', to: 'search_centre', to_label: null });
  });

  it('a duplicated priority counts once', () => {
    expect(order([cheapFar, dearClose, middle, worse], ['cheapest', 'cheapest'])).toEqual(order([cheapFar, dearClose, middle, worse], ['cheapest']));
  });
});

describe('geo', () => {
  it('measures a known distance', () => {
    // Porto (Ribeira) to Lisbon (Praça do Comércio): about 274 km in a straight line.
    const km = haversineKm({ latitude: 41.1408, longitude: -8.613 }, { latitude: 38.7075, longitude: -9.1364 });
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(278);
    expect(haversineKm({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBe(0);
  });

  it('finds the middle of points and counts nights', () => {
    expect(medianPoint([])).toBeNull();
    expect(medianPoint([{ latitude: 1, longitude: 10 }, { latitude: 3, longitude: 30 }, { latitude: 100, longitude: 20 }])).toEqual({ latitude: 3, longitude: 20 });
    expect(nightsBetween('2026-12-11', '2026-12-13')).toBe(2);
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2); // across a DST change in Europe
  });
});

describe('never a list of one: near-misses fill the list to MIN_SHOWN', () => {
  const MUSTS = ['parking', 'pets_allowed', 'free_cancellation', 'breakfast_included'] as const;
  it('over 2000 random searches with caps, must-haves, set-asides and anonymous visitors', () => {
    const rand = mulberry32(20261112);
    let filled = 0;
    for (let round = 0; round < 2000; round++) {
      const candidates = randomCandidates(rand, 1 + Math.floor(rand() * 14));
      const mustHaves = MUSTS.filter(() => rand() < 0.25);
      const priceCapMinor = rand() < 0.5 ? [3000, 4500, 6000, 9000][Math.floor(rand() * 4)] : null;
      const audience = rand() < 0.5 ? ('public' as const) : ('member' as const);
      const excludedPropertyIds = candidates.filter(() => rand() < 0.15).map((c) => c.propertyId);
      const priorities = SUBSETS[Math.floor(rand() * SUBSETS.length)];
      const r = rankStay({ ...base, candidates, mustHaves: [...mustHaves], priceCapMinor, audience, excludedPropertyIds, priorities });

      const shown = [...r.shortlist, ...r.nearMisses];
      const available = candidates.length - excludedPropertyIds.length;
      expect(shown).toHaveLength(Math.min(available, Math.max(MIN_SHOWN, r.shortlist.length)));
      if (r.shortlist.length >= MIN_SHOWN) expect(r.nearMisses).toEqual([]);
      if (r.nearMisses.length) filled += 1;
      // Ranks run on from the shortlist without a gap.
      expect(shown.map((x) => x.rank)).toEqual(shown.map((_, i) => i + 1));
      // The totals are the rejections, counted once each.
      expect(r.eligible + Object.values(r.rejected).reduce((a, b) => a + b, 0)).toBe(candidates.length);

      const nights = nightsBetween(base.checkIn, base.checkOut);
      let previous = 0;
      for (const n of r.nearMisses) {
        const c = n.candidate;
        expect(excludedPropertyIds).not.toContain(c.propertyId);
        expect(n.misses.length).toBeGreaterThan(0);
        expect(n.misses.length).toBeGreaterThanOrEqual(previous);
        previous = n.misses.length;
        // Oracle: every miss is true, written from the raw candidate, not the ranker's predicates.
        const perNight = Math.ceil(c.totalMinor / nights);
        const member = audience === 'public' && c.suggestedSellingMinor !== null && c.totalMinor < c.suggestedSellingMinor;
        expect(n.misses.some((m) => m.kind === 'member_price')).toBe(member);
        const over = n.misses.find((m) => m.kind === 'over_price_cap');
        expect(over ? over.over_by_minor : 0).toBe(priceCapMinor !== null && perNight > priceCapMinor ? perNight - priceCapMinor : 0);
        const has = (m: (typeof MUSTS)[number]) =>
          m === 'free_cancellation' ? c.refundable : m === 'breakfast_included' ? /breakfast/i.test(c.boardName ?? '') : (c.amenities ?? []).includes(m);
        const lacking = mustHaves.filter((m) => !has(m));
        const mh = n.misses.find((m) => m.kind === 'missing_must_have');
        expect(mh ? [...mh.must, ...mh.unknown].sort() : []).toEqual([...lacking].sort());
        // No hotel that fits is ever shown as a miss.
        expect(r.shortlist.map((s) => s.candidate.propertyId)).not.toContain(c.propertyId);
      }
    }
    expect(filled).toBeGreaterThan(500);
  });

  it('the Puerto Escondido case: one hotel fits, the rest are member-only, and four of them are listed', () => {
    const candidates = randomCandidates(mulberry32(7), 11).map((c, i) => ({
      ...c,
      totalMinor: 100_000 + i * 1000,
      suggestedSellingMinor: i === 0 ? null : 200_000,
    }));
    const r = rankStay({ ...base, candidates, audience: 'public', priorities: ['cheapest', 'closest'] });
    expect(r.shortlist).toHaveLength(1);
    expect(r.rejected.below_public_price).toBe(10);
    expect(r.nearMisses).toHaveLength(4);
    for (const n of r.nearMisses) expect(n.misses).toEqual([{ kind: 'member_price' }]);
  });

  it('minShown is a setting: 0 turns the filling off', () => {
    const candidates = randomCandidates(mulberry32(3), 8);
    expect(rankStay({ ...base, candidates, priorities: [], priceCapMinor: 1, minShown: 0 }).nearMisses).toEqual([]);
  });
});

describe('the city bound (docs/finder.md, "In the city")', () => {
  // A point `km` east of 40.4168, -3.7038 (Puerta del Sol), along the parallel.
  const east = (km: number) => ({ latitude: 40.4168, longitude: -3.7038 + km / (111.32 * Math.cos((40.4168 * Math.PI) / 180)) });
  const hotel = (i: number, over: Partial<Candidate>): Candidate => ({
    offerId: `o${i}`,
    propertyId: `p${i}`,
    name: `Hotel ${i}`,
    totalMinor: 20000,
    suggestedSellingMinor: null,
    location: east(0),
    rating: 8,
    reviewCount: 100,
    stars: 3,
    amenities: [],
    refundable: false,
    boardName: 'Room Only',
    ...over,
  });
  /** Nine central hotels, then a cheap, well-rated one `km` out. */
  const city = (farKm: number) => [
    ...Array.from({ length: 9 }, (_, i) => hotel(i, { location: east(((i % 3) - 1) * 0.5), totalMinor: 20000 + i * 1000 })),
    hotel(9, { name: 'Out of town', location: east(farKm), totalMinor: 9000, rating: 9.5, reviewCount: 5000 }),
  ];

  it('is the larger of the floor and four times the median distance, in 100 m steps', () => {
    expect(cityBoundKm([])).toBeNull();
    expect(cityBoundKm([0, 0, 0])).toBe(CITY_BOUND_MIN_KM);
    expect(cityBoundKm([1, 1.3, 1.5, 20])).toBe(8);
    expect(cityBoundKm([1, 3.4, 3.4, 25])).toBe(13.6);
    expect(cityBoundKm([3.04])).toBe(12.2);
  });

  it('a hotel past it does not fit, whatever the priorities; one inside it does', () => {
    for (const priorities of SUBSETS) {
      const out = rankStay({ ...base, candidates: city(12), priorities });
      expect(out.ordered.map((r) => r.candidate.name), label(priorities)).not.toContain('Out of town');
      expect(out.rejected.out_of_town).toBe(1);
      const inside = rankStay({ ...base, candidates: city(7.5), priorities });
      expect(inside.ordered.map((r) => r.candidate.name), label(priorities)).toContain('Out of town');
      expect(inside.rejected.out_of_town).toBe(0);
    }
  });

  it('is decided on the distance shown: 8.04 km reads 8.0 km and fits', () => {
    const r = rankStay({ ...base, candidates: city(8.04), priorities: ['cheapest'] });
    expect(r.shortlist[0]).toMatchObject({ candidate: { name: 'Out of town' }, km: 8 });
  });

  it('a hotel with no position is not known to be out of town', () => {
    const r = rankStay({ ...base, candidates: [...city(12).slice(0, 9), hotel(9, { name: 'Nowhere', location: null, totalMinor: 9000 })], priorities: ['cheapest'] });
    expect(r.shortlist[0].candidate.name).toBe('Nowhere');
    expect(r.rejected.out_of_town).toBe(0);
  });

  it('not applied when a place is named, or a brand asked for', () => {
    const sol = { point: east(0), label: 'Sol', from: 'place' as const };
    expect(rankStay({ ...base, candidates: city(12), priorities: ['cheapest'], near: sol })).toMatchObject({ cityBoundKm: null, rejected: { out_of_town: 0 } });
    const brand = city(12).map((c) => ({ ...c, chain: 'Crowne Plaza' }));
    const r = rankStay({ ...base, candidates: brand, priorities: ['cheapest'], filters: { minStars: null, minRating: null, propertyTypes: [], chains: ['Crowne Plaza'] } });
    expect(r).toMatchObject({ cityBoundKm: null, rejected: { out_of_town: 0 } });
    expect(r.shortlist[0].candidate.name).toBe('Out of town');
  });

  it('an out-of-town hotel is a near miss that says how far out it is, counted once by its first miss', () => {
    const r = rankStay({ ...base, candidates: city(12), priorities: ['cheapest'], priceCapMinor: 10_000 });
    expect(r.shortlist).toHaveLength(1);
    expect(r.nearMisses[0]).toMatchObject({ candidate: { name: 'Out of town' }, misses: [{ kind: 'out_of_town', km: 12, max_km: 8 }] });
    expect(r.rejected).toMatchObject({ out_of_town: 1, over_price_cap: 8 });
    const capped = rankStay({ ...base, candidates: city(12), priorities: ['cheapest'], priceCapMinor: 1, minShown: 10 });
    expect(capped.rejected).toMatchObject({ out_of_town: 0, over_price_cap: 10 });
    expect(capped.nearMisses.find((n) => n.candidate.name === 'Out of town')?.misses.map((m) => m.kind)).toEqual(['over_price_cap', 'out_of_town']);
  });

  it('dominance holds when the bound cuts: 400 random cities with suburbs, every set of priorities', () => {
    const rand = mulberry32(20261114);
    let cut = 0;
    for (const priorities of SUBSETS) {
      for (let round = 0; round < 400; round++) {
        const candidates = randomCandidates(rand, 6 + Math.floor(rand() * 12)).map((c) => ({
          ...c,
          location: c.location === null ? null : east([0, 0.4, 1, 2, 6, 9, 14][Math.floor(rand() * 7)]),
        }));
        const r = rankStay({ ...base, candidates, priorities });
        cut += r.rejected.out_of_town;
        for (const row of r.ordered) expect(row.km === null || row.km <= r.cityBoundKm!).toBe(true);
        for (let i = 0; i < r.ordered.length; i++) {
          for (let j = i + 1; j < r.ordered.length; j++) {
            const upper = { ...r.ordered[i].candidate, km: r.ordered[i].km };
            const lower = { ...r.ordered[j].candidate, km: r.ordered[j].km };
            if (dominates(lower, upper)) throw new Error(`round ${round}: ${lower.name} dominates ${upper.name} (priorities ${label(priorities)})`);
          }
        }
      }
    }
    expect(cut).toBeGreaterThan(500); // the bound was actually exercised
  });
});

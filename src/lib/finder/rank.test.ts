import { describe, expect, it } from 'vitest';

import { AMENITIES } from '@/lib/amenities';
import { haversineKm, medianPoint, nightsBetween } from './geo';
import { dominates, meetsMustHave, PRIORITY_KEYS, rankStay, type Candidate, type PriorityKey } from './rank';

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
  const priorities: Array<PriorityKey | null> = [...PRIORITY_KEYS, null];
  for (const priority of priorities) {
    it(`holds for priority=${priority ?? 'none'} over 400 random searches`, () => {
      const rand = mulberry32(20261111);
      let dominatedPairs = 0;
      for (let round = 0; round < 400; round++) {
        const candidates = randomCandidates(rand, 3 + Math.floor(rand() * 12));
        const near = rand() < 0.5 ? { latitude: 41.145, longitude: -8.615 } : null;
        const { ordered } = rankStay({ ...base, candidates, priority, near });
        for (let i = 0; i < ordered.length; i++) {
          for (let j = i + 1; j < ordered.length; j++) {
            const upper = { ...ordered[i].candidate, km: kmOf(ordered[i]) };
            const lower = { ...ordered[j].candidate, km: kmOf(ordered[j]) };
            if (dominates(lower, upper)) {
              throw new Error(`round ${round}: ${lower.name} dominates ${upper.name} but ranks below it (priority ${priority})`);
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
  it('the same candidates in any input order give the same ranking', () => {
    const rand = mulberry32(7);
    for (let round = 0; round < 100; round++) {
      const candidates = randomCandidates(rand, 10);
      const shuffled = [...candidates].sort(() => rand() - 0.5);
      for (const priority of [...PRIORITY_KEYS, null]) {
        const a = rankStay({ ...base, candidates, priority }).ordered.map((r) => r.candidate.offerId);
        const b = rankStay({ ...base, candidates: shuffled, priority }).ordered.map((r) => r.candidate.offerId);
        expect(b).toEqual(a);
      }
    }
  });

  it('does not mutate its input', () => {
    const candidates = randomCandidates(mulberry32(3), 8);
    const before = JSON.stringify(candidates);
    rankStay({ ...base, candidates, priority: 'cheapest' });
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
    const result = rankStay({ ...base, candidates: [hotel({ amenities: null })], priority: 'cheapest', mustHaves: ['parking'] });
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
    expect(rankStay({ ...three, candidates: [c], priority: 'cheapest', priceCapMinor: 10000 }).eligible).toBe(0);
    expect(rankStay({ ...three, candidates: [c], priority: 'cheapest', priceCapMinor: 10001 }).shortlist[0].perNightMinor).toBe(10001);
  });

  it('a member may see a price under the public price; an anonymous visitor may not', () => {
    const c = hotel({ totalMinor: 10000, suggestedSellingMinor: 12000 });
    expect(rankStay({ ...base, candidates: [c], priority: 'cheapest' }).eligible).toBe(1);
    expect(rankStay({ ...base, candidates: [c], priority: 'cheapest', audience: 'public' })).toMatchObject({
      eligible: 0,
      rejected: { below_public_price: 1 },
    });
    const atPar = hotel({ totalMinor: 12000, suggestedSellingMinor: 12000 });
    expect(rankStay({ ...base, candidates: [atPar], priority: 'cheapest', audience: 'public' }).eligible).toBe(1);
  });

  it('a hotel the user rejected does not come back', () => {
    const a = hotel({ offerId: 'a', propertyId: 'pa', totalMinor: 100 });
    const b = hotel({ offerId: 'b', propertyId: 'pb', totalMinor: 200 });
    const result = rankStay({ ...base, candidates: [a, b], priority: 'cheapest', excludedPropertyIds: ['pa'] });
    expect(result.shortlist.map((r) => r.candidate.propertyId)).toEqual(['pb']);
    expect(result.rejected.excluded_by_user).toBe(1);
  });

  it('the shortlist is five by default and its size can be set', () => {
    const many = Array.from({ length: 9 }, (_, i) => hotel({ offerId: `o${i}`, propertyId: `p${i}`, totalMinor: 100 + i }));
    expect(rankStay({ ...base, candidates: many, priority: 'cheapest' }).shortlist).toHaveLength(5);
    expect(rankStay({ ...base, candidates: many, priority: 'cheapest', size: 3 }).shortlist).toHaveLength(3);
    expect(rankStay({ ...base, candidates: many, priority: 'cheapest' }).ordered).toHaveLength(9);
  });

  it('"nicest" breaks a rating tie by how many people rated, before price', () => {
    const fewReviewsCheaper = hotel({ offerId: 'f', propertyId: 'pf', totalMinor: 10000, rating: 9.5, reviewCount: 40 });
    const manyReviewsDearer = hotel({ offerId: 'm', propertyId: 'pm', totalMinor: 30000, rating: 9.5, reviewCount: 4000 });
    const result = rankStay({ ...base, candidates: [fewReviewsCheaper, manyReviewsDearer], priority: 'nicest' });
    expect(result.shortlist.map((r) => r.candidate.offerId)).toEqual(['m', 'f']);
  });

  it('"basic" prefers a well-reviewed hotel over a cheaper unknown one', () => {
    const unknown = hotel({ offerId: 'u', propertyId: 'pu', totalMinor: 5000, rating: 9.9, reviewCount: 3 });
    const decent = hotel({ offerId: 'd', propertyId: 'pd', totalMinor: 9000, rating: 7.6, reviewCount: 500 });
    const result = rankStay({ ...base, candidates: [unknown, decent], priority: 'basic' });
    expect(result.shortlist.map((r) => r.candidate.offerId)).toEqual(['d', 'u']);
    expect(result.shortlist[0].reason).toEqual({ kind: 'cheapest_well_reviewed', rating: 7.6, reviews: 500 });
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

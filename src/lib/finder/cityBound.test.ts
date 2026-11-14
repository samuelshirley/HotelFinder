import { describe, expect, it } from 'vitest';

import { fixture, manifest } from '@/server/supplier/liteapi/fixtures';
import { normalizeRates } from '@/server/supplier/liteapi/normalize';
import { ratesResponse } from '@/server/supplier/liteapi/schemas';
import { toCandidates } from './candidates';
import { haversineKm } from './geo';
import { MIN_SHOWN, rankStay, type Candidate, type PriorityKey } from './rank';

/**
 * The city bound (docs/finder.md, "In the city") on two RECORDED city searches
 * of up to 200 hotels, made exactly as the app makes them (place id, 2 adults,
 * the 3% margin, 11–13 December 2026). Before the bound, "cheap and well
 * rated" put Valdebebas and Alcobendas (11–14 km out) in Madrid's top five and
 * Crowne Plaza Caparica, across the river, second in Lisbon.
 *
 * The oracle here is written from the raw points, not from rank.ts: the middle
 * of the results is the median latitude and longitude; the bound is the larger
 * of 8 km and four times the median hotel's distance from it, in 100 m steps.
 */
const AT = new Date('2026-11-11T12:00:00Z');
const STAY = { checkIn: '2026-12-11', checkOut: '2026-12-13', mustHaves: [], priceCapMinor: null, near: null, audience: 'member' as const };

function recorded(name: 'rates-city-madrid' | 'rates-city-lisbon') {
  const request = manifest.files[`${name}.json`].request as { margin: number; limit: number; placeId: string };
  const search = normalizeRates(ratesResponse.parse(fixture(name)), request.margin, AT);
  const candidates = toCandidates({
    offers: search.offers.map((offer) => ({ id: offer.supplierOfferId, offer })),
    properties: search.properties.map((property) => ({ id: property.supplierHotelId, property })),
    amenities: new Map(),
  });
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const pts = candidates.flatMap((c) => (c.location ? [c.location] : []));
  const middle = { latitude: median(pts.map((p) => p.latitude)), longitude: median(pts.map((p) => p.longitude)) };
  const bound = Math.max(8, Math.round(40 * median(pts.map((p) => haversineKm(middle, p)))) / 10);
  const km = (c: Candidate) => (c.location ? Math.round(haversineKm(middle, c.location) * 10) / 10 : null);
  const inTown = candidates.filter((c) => (km(c) ?? 0) <= bound);
  return { request, candidates, km, bound, inTown };
}

const MADRID = recorded('rates-city-madrid');
const LISBON = recorded('rates-city-lisbon');
const rank = (w: typeof MADRID, priorities: PriorityKey[], over: Partial<Parameters<typeof rankStay>[0]> = {}) =>
  rankStay({ ...STAY, candidates: w.candidates, priorities, ...over });
const top5 = (w: typeof MADRID, priorities: PriorityKey[]) => rank(w, priorities).shortlist.map((r) => r.candidate.name);

describe('the recordings are the searches the app makes, and reach the suburbs', () => {
  it('a city place id, up to 200 hotels, with hotels 10+ km from the middle', () => {
    for (const w of [MADRID, LISBON]) {
      expect(w.request.limit).toBe(200);
      expect(w.request.placeId).toMatch(/^ChIJ/);
      expect(w.candidates.length).toBeGreaterThan(150);
      expect(w.candidates.some((c) => (w.km(c) ?? 0) > 10)).toBe(true);
    }
    expect(MADRID.candidates.map((c) => c.name)).toEqual(expect.arrayContaining(['INNSiDE by Meliá Madrid Valdebebas', 'Hampton By Hilton Alcobendas Madrid']));
    expect(LISBON.candidates.map((c) => c.name)).toContain('Crowne Plaza Caparica Lisbon by IHG');
  });

  it('both are compact cities: the bound is the 8 km floor', () => {
    expect(MADRID.bound).toBe(8);
    expect(LISBON.bound).toBe(8);
  });
});

describe('a city searched with nothing named keeps to the city', () => {
  it('Madrid, cheap and well rated: no Valdebebas, no Alcobendas, nothing past the bound', () => {
    const r = rank(MADRID, ['cheapest', 'nicest']);
    expect(r.cityBoundKm).toBe(MADRID.bound);
    expect(top5(MADRID, ['cheapest', 'nicest']).join(' ')).not.toMatch(/Valdebebas|Alcobendas/);
    for (const row of r.ordered) expect(row.km!, row.candidate.name).toBeLessThanOrEqual(MADRID.bound);
  });

  it('Lisbon, cheap and well rated: Crowne Plaza Caparica is not on the list', () => {
    const r = rank(LISBON, ['cheapest', 'nicest']);
    expect(r.ordered.map((row) => row.candidate.name)).not.toContain('Crowne Plaza Caparica Lisbon by IHG');
    for (const row of r.ordered) expect(row.km!, row.candidate.name).toBeLessThanOrEqual(LISBON.bound);
  });

  it('Madrid, cheapest: the cheapest room in the city, not at the airport or in Coslada', () => {
    const top = rank(MADRID, ['cheapest']).shortlist[0];
    expect(top.km!).toBeLessThanOrEqual(8);
    expect(top.candidate.totalMinor).toBe(Math.min(...MADRID.inTown.map((c) => c.totalMinor)));
  });

  it('for every set of priorities, what fits is exactly the hotels within the bound (oracle from the raw points)', () => {
    const sets: PriorityKey[][] = [[], ['cheapest'], ['nicest'], ['closest'], ['cheapest', 'nicest'], ['cheapest', 'closest'], ['nicest', 'closest'], ['cheapest', 'nicest', 'closest']];
    for (const w of [MADRID, LISBON]) {
      const expected = w.inTown.map((c) => c.offerId).sort();
      for (const priorities of sets) {
        const r = rank(w, priorities);
        expect(r.ordered.map((row) => row.candidate.offerId).sort(), priorities.join('+')).toEqual(expected);
        expect(r.rejected.out_of_town).toBe(w.candidates.length - w.inTown.length);
      }
    }
  });
});

describe('when fewer than five fit, the near misses still fill the list', () => {
  it('a cap only three city hotels meet: out-of-town hotels under it are shown below, saying how far out they are', () => {
    const perNight = (c: Candidate) => Math.ceil(c.totalMinor / 2);
    const cap = [...MADRID.inTown.map(perNight)].sort((a, b) => a - b)[2];
    const r = rank(MADRID, ['cheapest'], { priceCapMinor: cap });
    const fits = MADRID.inTown.filter((c) => perNight(c) <= cap);
    expect(r.shortlist.map((row) => row.candidate.offerId).sort()).toEqual(fits.map((c) => c.offerId).sort());
    expect(r.shortlist.length).toBeLessThan(MIN_SHOWN);
    expect(r.shortlist.length + r.nearMisses.length).toBe(MIN_SHOWN);
    // The out-of-town hotels under the cap miss one thing; they are the cheapest misses.
    const farUnderCap = MADRID.candidates.filter((c) => (MADRID.km(c) ?? 0) > MADRID.bound && perNight(c) <= cap);
    expect(farUnderCap.length).toBeGreaterThanOrEqual(r.nearMisses.length);
    for (const miss of r.nearMisses) {
      expect(miss.misses).toEqual([{ kind: 'out_of_town', km: MADRID.km(miss.candidate), max_km: MADRID.bound }]);
    }
  });
});

describe('the bound does not apply where it should not', () => {
  it('a place named: distance is from it, and nothing is out of town', () => {
    const sol = { point: { latitude: 40.4169, longitude: -3.7035 }, label: 'Puerta del Sol', from: 'place' as const };
    const r = rank(MADRID, ['cheapest', 'nicest'], { near: sol });
    expect(r.cityBoundKm).toBeNull();
    expect(r.eligible).toBe(MADRID.candidates.length);
  });

  it('a brand asked for: its hotels are what the user wants, wherever they are', () => {
    const r = rank(LISBON, ['cheapest'], { filters: { minStars: null, minRating: null, propertyTypes: [], chains: ['Crowne Plaza'] } });
    expect(r.cityBoundKm).toBeNull();
    expect(r.rejected.out_of_town).toBe(0);
  });
});

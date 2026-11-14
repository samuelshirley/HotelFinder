import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizeRates, normalizeStaticFacts } from '@/server/supplier/liteapi/normalize';
import { hotelListResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import { toCandidates } from './candidates';
import { haversineKm } from './geo';
import { PERSONAS, type Persona } from './personas';
import { rankStay, type Candidate, type NearTarget } from './rank';
import { placeDetailsResponse } from '@/server/supplier/liteapi/schemas';

/**
 * Each persona is judged on the RECORDED Porto search (20 real hotels, 2
 * adults, 11–13 December 2026). The oracle below is written against the raw
 * recording and does not call the ranking's own predicates, so a bug in
 * `meetsMustHave` cannot agree with itself.
 */
const AT = new Date('2026-11-11T12:00:00Z');
const CHECK_IN = '2026-12-11';
const CHECK_OUT = '2026-12-13';
const NIGHTS = 2;

type RawHotel = { facilityIds: number[]; refundable: boolean; board: string };
const rawStatic = hotelListResponse.parse(fixture('hotels-static-porto')).data;

function world(ratesFixture: string) {
  const parsed = ratesResponse.parse(fixture(ratesFixture));
  const search = normalizeRates(parsed, 0, AT);
  const facts = normalizeStaticFacts(hotelListResponse.parse(fixture('hotels-static-porto')));
  const candidates = toCandidates({
    offers: search.offers.map((offer) => ({ id: offer.supplierOfferId, offer })),
    properties: search.properties.map((property) => ({ id: property.supplierHotelId, property })),
    amenities: new Map(facts.map((f) => [f.supplierHotelId, f.amenities])),
  });
  const raw = new Map<string, RawHotel>(
    parsed.data.map((h) => [
      h.hotelId,
      {
        facilityIds: rawStatic.find((s) => s.id === h.hotelId)?.facilityIds ?? [],
        refundable: h.roomTypes[0].rates[0].cancellationPolicies.refundableTag === 'RFN',
        board: h.roomTypes[0].rates[0].boardName ?? '',
      },
    ]),
  );
  return { candidates, raw };
}

const MEMBER = world('rates-city-porto');
const AIRPORT = world('rates-radius-porto-airport');
const point = (name: string) => placeDetailsResponse.parse(fixture(name)).data.location;
/** The airport's map point, as the supplier gives it: the default "close" target when the airport is the destination. */
const OPO = point('place-porto-airport');
const MEMBER_PROPERTY = normalizeRates(ratesResponse.parse(fixture('rates-city-porto')), 0, AT).properties[0];
const PUBLIC = world('rates-city-porto-margin-15');

/** The must-haves, straight from the supplier's facility ids. */
const ORACLE: Record<string, (h: RawHotel) => boolean> = {
  pets_allowed: (h) => h.facilityIds.includes(4),
  parking: (h) => [2, 46, 52, 161, 181].some((id) => h.facilityIds.includes(id)),
  pool: (h) => [301, 103, 104, 120, 122, 192, 193].some((id) => h.facilityIds.includes(id)),
  family_rooms: (h) => h.facilityIds.includes(28),
  wifi: (h) => h.facilityIds.includes(47) || h.facilityIds.includes(107),
  soundproof_rooms: (h) => h.facilityIds.includes(64),
  wheelchair_accessible: (h) => h.facilityIds.includes(185),
  lift: (h) => h.facilityIds.includes(48) || h.facilityIds.includes(491),
  fitness: (h) => h.facilityIds.includes(11) || h.facilityIds.includes(492),
  air_conditioning: (h) => h.facilityIds.includes(109),
  airport_shuttle: (h) => [17, 139, 140].some((id) => h.facilityIds.includes(id)),
  free_cancellation: (h) => h.refundable,
  breakfast_included: (h) => /breakfast/i.test(h.board),
};

function eligibleFor(persona: Persona, w: typeof MEMBER): Candidate[] {
  const outOfTown = cityOracle(persona, w);
  return w.candidates.filter((c) => {
    const raw = w.raw.get(c.propertyId)!;
    if (!persona.mustHaves.every((m) => ORACLE[m](raw))) return false;
    if (persona.capPerNightMinor !== null && Math.ceil(c.totalMinor / NIGHTS) > persona.capPerNightMinor) return false;
    if (persona.audience === 'public' && c.suggestedSellingMinor !== null && c.totalMinor < c.suggestedSellingMinor) return false;
    if (outOfTown(c)) return false;
    return true;
  });
}

/**
 * The city rule (docs/finder.md, "In the city"), written here from the raw
 * points: a city searched with no place named keeps to the larger of 8 km and
 * four times the median hotel's distance from the middle of the results, on
 * the 100 m steps shown. A named place or a radius search has no such bound.
 */
function cityOracle(persona: Persona, w: typeof MEMBER): (c: Candidate) => boolean {
  if (targetFor(persona)) return () => false;
  const middle = pointFor(persona);
  const exact = w.candidates.flatMap((c) => (c.location ? [haversineKm(middle, c.location)] : [])).sort((a, b) => a - b);
  const m = Math.floor(exact.length / 2);
  const median = exact.length % 2 ? exact[m] : (exact[m - 1] + exact[m]) / 2;
  const bound = Math.max(8, Math.round(40 * median) / 10);
  return (c) => c.location !== null && Math.round(haversineKm(middle, c.location) * 10) / 10 > bound;
}

/** As planSearch decides it: a named place, else the airport's point, else (a city) the middle of the results. */
function targetFor(persona: Persona): NearTarget | null {
  if (persona.near) return { point: persona.near, label: persona.nearLabel, from: 'place' };
  return persona.search === 'airport' ? { point: OPO, label: 'Porto Airport (OPO)', from: 'destination' } : null;
}
const located = (w: typeof MEMBER) => w.candidates.flatMap((c) => (c.location ? [c.location] : []));
/** The point distance is measured from, for the oracles: the same rule, computed here. */
function pointFor(persona: Persona): { latitude: number; longitude: number } {
  const t = targetFor(persona);
  if (t) return t.point;
  const pts = located(persona.audience === 'public' ? PUBLIC : MEMBER);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { latitude: median(pts.map((p) => p.latitude)), longitude: median(pts.map((p) => p.longitude)) };
}

function run(persona: Persona) {
  const w = persona.search === 'airport' ? AIRPORT : persona.audience === 'public' ? PUBLIC : MEMBER;
  const result = rankStay({
    candidates: w.candidates,
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    priorities: persona.priorities,
    mustHaves: persona.mustHaves,
    priceCapMinor: persona.capPerNightMinor,
    near: targetFor(persona),
    audience: persona.audience,
  });
  return { w, result, eligible: eligibleFor(persona, w) };
}

/**
 * The combined oracle, written here from the raw values and NOT from rank.ts:
 * equal-weight rank percentiles over the chosen metrics (unknown is worst,
 * ties share the middle), distance in the 100 m steps the user is shown,
 * then price, rating, distance, reviews to break a tie.
 */
function oracleTop(persona: Persona, eligible: Candidate[]): Candidate {
  const target = pointFor(persona);
  const km = (c: Candidate) => (c.location ? Math.round(haversineKm(target, c.location) * 10) / 10 : Infinity);
  const metric: Record<string, (c: Candidate) => number> = {
    cheapest: (c) => c.totalMinor,
    nicest: (c) => -(c.rating ?? -Infinity),
    closest: km,
  };
  const pct = (m: (c: Candidate) => number, c: Candidate) => {
    const v = m(c);
    const better = eligible.filter((o) => m(o) < v).length;
    const ties = eligible.filter((o) => m(o) === v).length;
    return eligible.length > 1 ? (better + (ties - 1) / 2) / (eligible.length - 1) : 0;
  };
  const score = (c: Candidate) => persona.priorities.reduce((sum, k) => sum + pct(metric[k], c), 0);
  const chain = ['cheapest', 'nicest', 'closest'].sort((a, b) => Number(!persona.priorities.includes(a as never)) - Number(!persona.priorities.includes(b as never)));
  return [...eligible].sort((a, b) => {
    const d = score(a) - score(b);
    if (Math.abs(d) > 1e-9) return d;
    for (const k of chain) if (metric[k](a) !== metric[k](b)) return metric[k](a) - metric[k](b);
    return -(a.reviewCount ?? -1) + (b.reviewCount ?? -1);
  })[0];
}

describe('27 personas on the recorded Porto searches', () => {
  it('there are twenty-seven, with distinct ids', () => {
    expect(PERSONAS).toHaveLength(27);
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(27);
  });

  for (const persona of PERSONAS) {
    describe(`${persona.id}: "${persona.says}"`, () => {
      const { result, eligible } = run(persona);

      it('the shortlist holds only hotels that meet every hard requirement', () => {
        const allowed = new Set(eligible.map((c) => c.propertyId));
        for (const row of result.ordered) expect(allowed.has(row.candidate.propertyId), row.candidate.name).toBe(true);
        expect(result.eligible).toBe(eligible.length);
        expect(result.shortlist).toHaveLength(Math.min(5, eligible.length));
      });

      it('the first pick is the best there is for what this person asked', () => {
        const top = result.shortlist[0]?.candidate;
        if (eligible.length === 0) {
          expect(top).toBeUndefined();
          return;
        }
        expect(top).toBeDefined();
        const [only] = persona.priorities;
        if (persona.priorities.length > 1) {
          expect(top.name).toBe(oracleTop(persona, eligible).name);
        } else if (only === 'cheapest') {
          expect(top.totalMinor).toBe(Math.min(...eligible.map((c) => c.totalMinor)));
        } else if (only === 'nicest') {
          expect(top.rating).toBe(Math.max(...eligible.map((c) => c.rating ?? -1)));
        } else if (only === 'closest') {
          // Distance in the 100 m steps the user is shown, from the place named or the destination's own point.
          const target = pointFor(persona);
          const km = (c: Candidate) => Math.round(haversineKm(target, c.location!) * 10) / 10;
          expect(km(top)).toBe(Math.min(...eligible.map(km)));
        }
      });

      it('every row says why it is there', () => {
        result.shortlist.forEach((row, i) => {
          expect(row.rank).toBe(i + 1);
          expect(row.reason.kind === 'runner_up').toBe(i > 0);
        });
      });
    });
  }
});

describe('the picks a person would recognise as right', () => {
  const pick = (id: string) => run(PERSONAS.find((p) => p.id === id)!);
  const names = (id: string) => pick(id).result.shortlist.map((r) => r.candidate.name);

  it('backpacker: the cheapest room in town', () => {
    const { result } = pick('backpacker');
    expect(result.shortlist[0]).toMatchObject({ candidate: { name: 'YOTEL Porto', totalMinor: 11068 }, perNightMinor: 5534 });
    expect(result.shortlist[0].reason).toEqual({ kind: 'cheapest_meeting_all_musts' });
    expect(names('backpacker').slice(0, 3)).toEqual(['YOTEL Porto', 'Porto Palácio Hotel by The Editory', 'Mercure Porto Centro Santa Catarina']);
    expect(result.shortlist[1].reason).toMatchObject({ kind: 'runner_up', price_delta_minor: 989 });
  });

  it('dog owner: the cheapest that takes dogs, not the cheapest', () => {
    expect(names('dog-owner')[0]).toBe('Mercure Porto Centro Aliados');
    expect(pick('dog-owner').result.eligible).toBe(7);
  });

  it('plans may change: the cheapest refundable room', () => {
    expect(names('plans-may-change')).toEqual([
      'Mercure Porto Centro Santa Catarina',
      'Hotel Carris Porto Ribeira',
      'Vincci Porto',
      'Sheraton Porto Hotel & Spa',
    ]);
  });

  it('honeymooners: the best rated, and among equals the one more people rated', () => {
    const { result } = pick('honeymooners');
    expect(result.shortlist[0].candidate.name).toBe('ICON Duplo Ribeira');
    expect(result.shortlist[0].reason).toEqual({ kind: 'best_rated', rating: 9.8, reviews: 3056 });
  });

  it('riverside worker: closest to Ribeira, with the distance stated', () => {
    const { result } = pick('riverside-worker');
    expect(result.shortlist[0].candidate.name).toBe('Hotel Carris Porto Ribeira');
    expect(result.shortlist[0].reason).toEqual({ kind: 'closest', km: 0.1, to: 'place', to_label: 'Ribeira' });
    expect(result.distanceFrom).toBe('place');
  });

  it('breakfast first: only rooms sold with breakfast', () => {
    expect(names('breakfast-first')).toEqual(['Hotel Spot Family Suites', 'ICON Duplo Ribeira', 'Torel Avantgarde', 'Torel Palace Porto']);
  });

  it('luxury dog owner, summer driver, dog-car-breakfast', () => {
    expect(names('luxury-dog-owner')[0]).toBe('Torel Palace Porto');
    expect(names('summer-driver')[0]).toBe('Vincci Porto');
    expect(names('dog-car-breakfast')).toEqual(['Torel Avantgarde', 'Torel Palace Porto']);
  });

  it('close and nice: the best rated hotel by the river, whichever order it was asked in', () => {
    expect(names('close-and-nice')[0]).toBe('ICON Duplo Ribeira');
    expect(names('close-and-nice-reversed')).toEqual(names('close-and-nice'));
    expect(pick('close-and-nice').result.shortlist[0].reason).toMatchObject({ kind: 'best_mix', of: ['nicest', 'closest'], km: 0.2, to: 'place', to_label: 'Ribeira', rating: 9.8, price_rank: 14, eligible: 20 });
  });

  it('cheap and close: the cheap hotel on the river, not the cheapest in town or the closest at any price', () => {
    expect(names('cheap-and-close').slice(0, 2)).toEqual(['Hotel Carris Porto Ribeira', 'Mercure Porto Centro Santa Catarina']);
    expect(names('cheap-and-close')[0]).not.toBe(names('backpacker')[0]);
  });

  it('nice but not crazy expensive: well rated, seventh cheapest of twenty', () => {
    expect(names('nice-not-crazy')[0]).toBe('Mercure Porto Centro Aliados');
    expect(pick('nice-not-crazy').result.shortlist[0].reason).toMatchObject({ kind: 'best_mix', of: ['cheapest', 'nicest'], rating: 9.2, price_rank: 7, eligible: 20 });
    // The old "just a decent bed" travellers now ask for exactly this pair.
    expect(names('wheelchair-user')[0]).toBe('Mercure Porto Centro Aliados');
  });

  it('all three, and the dog-friendly version of value for money', () => {
    expect(names('all-three')[0]).toBe('ICON Duplo Ribeira');
    expect(names('dog-nice-value')[0]).toBe('ICON Duplo Ribeira');
    expect(pick('dog-nice-value').result.eligible).toBe(7);
  });

  it('cheap near the airport: judged on a radius search around it, measured from it', () => {
    const { result } = pick('airport-cheap');
    expect(result.shortlist[0].candidate.name).toBe('Hotel Aeroporto');
    expect(result).toMatchObject({ distanceFrom: 'destination', distanceLabel: 'Porto Airport (OPO)' });
    for (const row of result.ordered) expect(row.km!).toBeLessThan(6);
  });

  it('late flight, central: now has a real check, from the middle of the results', () => {
    expect(pick('late-flight').result.shortlist[0]).toMatchObject({ candidate: { name: 'Eurostars Porto Centro' }, km: 0.2 });
  });

  it('impossible budget: nothing, and it says why', () => {
    const { result } = pick('impossible-budget');
    expect(result.shortlist).toEqual([]);
    expect(result.rejected).toEqual({ over_price_cap: 20, missing_must_have: 0, filtered_out: 0, below_public_price: 0, excluded_by_user: 0, out_of_town: 0 });
  });

  it('dog and flexible: no hotel that takes dogs is refundable on these dates', () => {
    const { result } = pick('dog-and-flexible');
    expect(result.shortlist).toEqual([]);
    expect(result.rejected.missing_must_have).toBe(20);
  });

  it('anonymous browser: never shown a price under the hotel\'s public price', () => {
    const { result, w } = pick('anonymous-browser');
    expect(result.rejected.below_public_price).toBe(2);
    expect(result.eligible).toBe(18);
    for (const row of result.ordered) {
      const c = row.candidate;
      if (c.suggestedSellingMinor !== null) expect(c.totalMinor).toBeGreaterThanOrEqual(c.suggestedSellingMinor);
    }
    expect(w.candidates.filter((c) => c.name === 'Vincci Porto')[0].totalMinor).toBeLessThan(18269);
    expect(result.ordered.some((r) => r.candidate.name === 'Vincci Porto')).toBe(false);
  });

  it('the city bound cuts nothing in the recorded Porto search: its 20 hotels are all central', () => {
    for (const id of ['backpacker', 'undecided', 'late-flight', 'anonymous-browser']) {
      const { result } = pick(id);
      expect(result.cityBoundKm, id).toBe(8);
      expect(result.rejected.out_of_town, id).toBe(0);
    }
    expect(pick('riverside-worker').result.cityBoundKm).toBeNull();
    expect(pick('airport-cheap').result.cityBoundKm).toBeNull();
  });

  it('undecided: a balanced pick, labelled as such, measured from the middle of the results', () => {
    const { result } = pick('undecided');
    expect(result.shortlist[0].reason).toEqual({ kind: 'best_balance' });
    expect(result).toMatchObject({ distanceFrom: 'search_centre', distanceLabel: null });
    expect(result.shortlist).toHaveLength(5);
  });
});

describe('one candidate per hotel', () => {
  it('a hotel with four recorded room types is represented by its cheapest', () => {
    const parsed = ratesResponse.parse(fixture('rates-one-hotel'));
    const search = normalizeRates(parsed, 0, AT);
    expect(search.offers).toHaveLength(4);
    const candidates = toCandidates({
      offers: search.offers.map((offer) => ({ id: offer.supplierOfferId, offer })),
      properties: [{ id: 'p1', property: { ...MEMBER_PROPERTY, supplierHotelId: parsed.data[0].hotelId } }],
      amenities: new Map(),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].totalMinor).toBe(Math.min(...search.offers.map((o) => o.total.amountMinor)));
    expect(candidates[0].totalMinor).toBe(15982);
    expect(candidates[0].amenities).toBeNull();
  });

  it('an offer whose hotel has no property row is dropped, not shown bare', () => {
    const search = normalizeRates(ratesResponse.parse(fixture('rates-one-hotel')), 0, AT);
    expect(toCandidates({ offers: search.offers.map((offer) => ({ id: 'x', offer })), properties: [], amenities: new Map() })).toEqual([]);
  });
});

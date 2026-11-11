import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizeRates, normalizeStaticFacts } from '@/server/supplier/liteapi/normalize';
import { hotelListResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import { toCandidates } from './candidates';
import { haversineKm } from './geo';
import { PERSONAS, type Persona } from './personas';
import { rankStay, type Candidate } from './rank';

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
  return w.candidates.filter((c) => {
    const raw = w.raw.get(c.propertyId)!;
    if (!persona.mustHaves.every((m) => ORACLE[m](raw))) return false;
    if (persona.capPerNightMinor !== null && Math.ceil(c.totalMinor / NIGHTS) > persona.capPerNightMinor) return false;
    if (persona.audience === 'public' && c.suggestedSellingMinor !== null && c.totalMinor < c.suggestedSellingMinor) return false;
    return true;
  });
}

function run(persona: Persona) {
  const w = persona.audience === 'public' ? PUBLIC : MEMBER;
  const result = rankStay({
    candidates: w.candidates,
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    priority: persona.priority,
    mustHaves: persona.mustHaves,
    priceCapMinor: persona.capPerNightMinor,
    near: persona.near,
    audience: persona.audience,
  });
  return { w, result, eligible: eligibleFor(persona, w) };
}

describe('20 personas on the recorded Porto search', () => {
  it('there are twenty, with distinct ids', () => {
    expect(PERSONAS).toHaveLength(20);
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(20);
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
        if (persona.priority === 'cheapest') {
          expect(top.totalMinor).toBe(Math.min(...eligible.map((c) => c.totalMinor)));
        } else if (persona.priority === 'nicest') {
          expect(top.rating).toBe(Math.max(...eligible.map((c) => c.rating ?? -1)));
        } else if (persona.priority === 'closest' && persona.near) {
          // Distance in the 100 m steps the user is shown.
          const km = (c: Candidate) => Math.round(haversineKm(persona.near!, c.location!) * 10) / 10;
          expect(km(top)).toBe(Math.min(...eligible.map(km)));
        } else if (persona.priority === 'basic') {
          const decent = eligible.filter((c) => (c.rating ?? 0) >= 7.5 && (c.reviewCount ?? 0) >= 50);
          const pool = decent.length > 0 ? decent : eligible;
          expect(top.totalMinor).toBe(Math.min(...pool.map((c) => c.totalMinor)));
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
    expect(result.shortlist[0].reason).toEqual({ kind: 'closest', km: 0.1, to: 'place' });
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

  it('impossible budget: nothing, and it says why', () => {
    const { result } = pick('impossible-budget');
    expect(result.shortlist).toEqual([]);
    expect(result.rejected).toEqual({ over_price_cap: 20, missing_must_have: 0, below_public_price: 0, excluded_by_user: 0 });
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

  it('undecided: a balanced pick, labelled as such, measured from the middle of the results', () => {
    const { result } = pick('undecided');
    expect(result.shortlist[0].reason).toEqual({ kind: 'best_balance' });
    expect(result.distanceFrom).toBe('search_centre');
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

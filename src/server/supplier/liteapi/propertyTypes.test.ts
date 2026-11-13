import { describe, expect, it } from 'vitest';

import { PROPERTY_TYPES } from '@/lib/filters';
import { fixture } from './fixtures';
import { normalizeStaticFacts } from './normalize';
import { chainName, HOTEL_TYPE_IDS, propertyTypeFromId } from './propertyTypes';
import { hotelListResponse } from './schemas';

/** Each mapped id, and the supplier's own name for it in the recorded /data/hotelTypes. */
const NAMES: Record<number, string> = {
  204: 'Hotels',
  219: 'Aparthotels',
  201: 'Apartments',
  203: 'Hostels',
  264: 'Hostel/Backpacker accommodation',
  208: 'Bed and breakfasts',
  216: 'Guest houses',
  247: 'Pension',
  220: 'Holiday homes',
  213: 'Villas',
};

describe('kinds of place, from the supplier type ids', () => {
  const recorded = new Map(
    (fixture('hotel-types').data as unknown as Array<{ id: number; name: string }>).map((t) => [t.id, t.name]),
  );

  it('every mapped id is in the recorded type list, under the name the comment gives', () => {
    const mapped = Object.values(HOTEL_TYPE_IDS).flat();
    expect(mapped.sort()).toEqual(Object.keys(NAMES).map(Number).sort());
    for (const id of mapped) expect(recorded.get(id), `type ${id}`).toBe(NAMES[id]);
    expect(recorded.get(0)).toBe('Not Available');
  });

  it('every kind offered is backed by at least one id, and no id backs two kinds', () => {
    for (const t of PROPERTY_TYPES) expect(HOTEL_TYPE_IDS[t].length, t).toBeGreaterThan(0);
    const all = Object.values(HOTEL_TYPE_IDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('0 and a missing id say nothing; an unmapped id is another kind of place', () => {
    expect(propertyTypeFromId(0)).toBeNull();
    expect(propertyTypeFromId(null)).toBeNull();
    expect(propertyTypeFromId(undefined)).toBeNull();
    expect(propertyTypeFromId(265)).toBe('other'); // Houseboat
    expect(propertyTypeFromId(201)).toBe('apartment');
  });

  it('"Not Available" as a chain is silence, not a brand', () => {
    expect(chainName('Not Available')).toBeNull();
    expect(chainName(' not available ')).toBeNull();
    expect(chainName('')).toBeNull();
    expect(chainName(null)).toBeNull();
    expect(chainName('Mercure')).toBe('Mercure');
  });
});

describe('static facts carry the kind of place and the chain (recorded)', () => {
  it('the 20 hotels of the recorded Porto search: all hotels, chains as listed, none where it says Not Available', () => {
    const facts = normalizeStaticFacts(hotelListResponse.parse(fixture('hotels-static-porto')));
    expect(facts).toHaveLength(20);
    expect(new Set(facts.map((f) => f.propertyType))).toEqual(new Set(['hotel']));
    expect(facts.filter((f) => f.chain === 'Mercure')).toHaveLength(2);
    expect(facts.filter((f) => f.chain === null)).toHaveLength(6);
    expect(facts.some((f) => f.chain === 'Not Available')).toBe(false);
  });

  it('a page of Porto with apartments, hostels, B&Bs and guest houses reads each as its kind', () => {
    const raw = fixture('hotels-static-porto-mixed');
    const facts = normalizeStaticFacts(hotelListResponse.parse(raw));
    const ids = (raw.data as unknown as Array<{ hotelTypeId: number }>).map((h) => h.hotelTypeId);
    facts.forEach((f, i) => expect(f.propertyType).toBe(propertyTypeFromId(ids[i])));
    const kinds = new Set(facts.map((f) => f.propertyType));
    for (const k of ['apartment', 'hostel', 'bed_and_breakfast', 'guest_house', 'aparthotel', 'hotel']) expect(kinds.has(k as never), k).toBe(true);
    expect(facts.find((f) => f.propertyType === 'aparthotel')?.chain).toBe('limehome');
  });

  it('a malformed type or chain is unknown, not a failed call', () => {
    const raw = fixture('hotels-static-porto');
    const broken = { ...raw, data: (raw.data as unknown as Array<Record<string, unknown>>).map((h, i) => (i === 0 ? { ...h, hotelTypeId: 'hotel', chain: 7 } : h)) };
    const facts = normalizeStaticFacts(hotelListResponse.parse(broken));
    expect(facts[0].propertyType).toBeNull();
    expect(facts[0].chain).toBeNull();
    expect(facts[1].propertyType).toBe('hotel');
  });
});

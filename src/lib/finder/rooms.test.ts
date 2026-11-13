import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizePrebook, normalizeRates } from '@/server/supplier/liteapi/normalize';
import { prebookResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import { cheapestPerHotel, MAX_ROOMS, MAX_SPLITS, occupanciesFor, roomCounts, roomsLabel, roomsOf, sameOccupancies, splitParty, type HeldOffer } from './rooms';

const AT = new Date('2026-11-13T12:00:00Z');
const offersOf = (name: string) => normalizeRates(ratesResponse.parse(fixture(name)), 15, AT).offers;

describe('which room splits are priced', () => {
  it.each([
    [1, [], [1]],
    [2, [], [1]],
    [2, [6], [1]],
    [1, [3, 5], [1]],
    [3, [], [1, 2]],
    [4, [], [1, 2]],
    [2, [4, 9], [1, 2]],
    [5, [], [2, 3]],
    [6, [], [2, 3]],
    [2, [4, 9, 12], [2]],
    [12, [], [3, 5, 6]],
  ])('%i adults, children %j: %j rooms', (adults, ages, counts) => {
    expect(roomCounts(adults, ages)).toEqual(counts);
  });

  it('for every party: at most three searches, never more rooms than adults or than six, never a room without an adult, nobody left out', () => {
    for (let adults = 1; adults <= 12; adults++) {
      for (let kids = 0; kids <= 8; kids++) {
        const ages = Array.from({ length: kids }, (_, i) => i * 2);
        const counts = roomCounts(adults, ages);
        expect(counts.length).toBeGreaterThanOrEqual(1);
        expect(counts.length).toBeLessThanOrEqual(MAX_SPLITS);
        expect([...counts].sort((a, b) => a - b)).toEqual(counts);
        expect(new Set(counts).size).toBe(counts.length);
        for (const split of occupanciesFor({ adults, childrenAges: ages, rooms: null })) {
          expect(split.length).toBeLessThanOrEqual(Math.min(adults, MAX_ROOMS));
          expect(split.every((r) => r.adults >= 1)).toBe(true);
          expect(split.reduce((n, r) => n + r.adults, 0)).toBe(adults);
          expect(split.flatMap((r) => r.childrenAges).sort((a, b) => a - b)).toEqual(ages);
        }
      }
    }
  });

  it('rooms the user fixed are the one search, split as before', () => {
    expect(occupanciesFor({ adults: 4, childrenAges: [], rooms: 1 })).toEqual([[{ adults: 4, childrenAges: [] }]]);
    expect(occupanciesFor({ adults: 3, childrenAges: [5], rooms: 2 })).toEqual([splitParty(3, [5], 2)]);
    expect(occupanciesFor({ adults: 4, childrenAges: [], rooms: null })).toEqual([
      [{ adults: 4, childrenAges: [] }],
      [{ adults: 2, childrenAges: [] }, { adults: 2, childrenAges: [] }],
    ]);
    // A family of four as two rooms: one adult and one child in each, as recorded.
    expect(occupanciesFor({ adults: 2, childrenAges: [4, 9], rooms: null })[1]).toEqual([
      { adults: 1, childrenAges: [4] },
      { adults: 1, childrenAges: [9] },
    ]);
  });
});

describe('what the price is for, in words', () => {
  const room = (name: string, adults = 2, childrenAges: number[] = []) => ({ name, boardName: null, adults, childrenAges });

  it('one room is its name; the same room twice is counted; different rooms are each named', () => {
    expect(roomsLabel([room('Family Room', 4)])).toBe('Family Room');
    expect(roomsLabel([room('Vincci Room'), room('Vincci Room')])).toBe('2 rooms: 2 × Vincci Room');
    expect(roomsLabel([room('Double Room Classic'), room('Twin Room Classic')])).toBe('2 rooms: Double Room Classic + Twin Room Classic');
    expect(roomsLabel([room('A'), room('B'), room('A')])).toBe('3 rooms: 2 × A + B');
    expect(roomsLabel([])).toBeNull();
  });

  it('says who sleeps where when the rooms hold different parties: the recorded two-room prebook', () => {
    const check = normalizePrebook(prebookResponse.parse(fixture('prebook-mixed-rooms')), AT);
    expect(check.rooms.map((r) => [r.name, r.adults, r.childrenAges])).toEqual([
      ['Vincci Room', 2, []],
      ['Vincci Room Uso Individual', 1, []],
    ]);
    expect(roomsLabel(check.rooms)).toBe('2 rooms: Vincci Room (2 adults) + Vincci Room Uso Individual (1 adult)');
    expect(roomsLabel([room('Double', 1, [4]), room('Double', 1, [9])])).toBe('2 rooms: 2 × Double');
    expect(roomsLabel([room('Double', 1, [4]), room('Single', 1)])).toBe('2 rooms: Double (1 adult, 1 child) + Single (1 adult)');
  });

  it('every recorded two-room offer is labelled from its own two rooms', () => {
    for (const o of offersOf('rates-four-adults-two-rooms')) {
      expect(o.rooms).toHaveLength(2);
      expect(roomsLabel(o.rooms)).toMatch(/^2 rooms: /);
    }
  });
});

describe('the same rooms', () => {
  it('compares who is in each room, in order, and never the names', () => {
    const a = [{ adults: 2, childrenAges: [] }, { adults: 1, childrenAges: [] }];
    expect(sameOccupancies(a, [{ adults: 2, childrenAges: [] }, { adults: 1, childrenAges: [] }])).toBe(true);
    expect(sameOccupancies(a, [{ adults: 1, childrenAges: [] }, { adults: 2, childrenAges: [] }])).toBe(false);
    expect(sameOccupancies(a, [{ adults: 3, childrenAges: [] }])).toBe(false);
    expect(sameOccupancies([{ adults: 1, childrenAges: [4] }], [{ adults: 1, childrenAges: [9] }])).toBe(false);
  });

  it('reads an offer row\'s rooms only when every room says who it is for', () => {
    expect(roomsOf(null)).toBeNull();
    expect(roomsOf([])).toBeNull();
    expect(roomsOf([{ name: 'X', adults: 2 }])).toBeNull();
    expect(roomsOf([{ name: 'X', boardName: null, adults: 2, childrenAges: [] }])).toHaveLength(1);
  });
});

describe('one offer per hotel, across the splits', () => {
  it('each recorded hotel is priced at its cheaper combination: two rooms at five hotels, one room at one', () => {
    const one = offersOf('rates-four-adults-one-room');
    const two = offersOf('rates-four-adults-two-rooms');
    const rows = [...one, ...two].map((o, i) => ({
      id: `o${String(i).padStart(3, '0')}`,
      propertyId: o.supplierHotelId,
      totalMinor: o.total.amountMinor,
      payAtPropertyMinor: o.payAtProperty.amountMinor,
      suggestedSellingMinor: o.suggestedSelling?.amountMinor ?? null,
      rooms: o.rooms.length,
    }));
    const picked = new Map(cheapestPerHotel(rows, 'member').map((r) => [r.propertyId, r]));
    // Every hotel either split found, once.
    expect(picked.size).toBe(new Set([...one, ...two].map((o) => o.supplierHotelId)).size);
    // The oracle, from the raw recordings: the lower all-in price of the two.
    const allIn = (o: (typeof one)[number]) => o.total.amountMinor + o.payAtProperty.amountMinor;
    let oneRoomWins = 0;
    for (const [hotel, row] of picked) {
      const best = Math.min(...[...one, ...two].filter((o) => o.supplierHotelId === hotel).map(allIn));
      expect(row.totalMinor + row.payAtPropertyMinor).toBe(best);
      if (row.rooms === 1) oneRoomWins += 1;
    }
    // Recorded 2026-11-13: of the six hotels with a room for four, one is cheaper that way.
    expect(new Set(one.map((o) => o.supplierHotelId)).size).toBe(6);
    expect(oneRoomWins).toBe(1);
    expect(picked.get('lpa0fef')?.rooms).toBe(1);
    expect(picked.get('lp76a2a')?.rooms).toBe(2);
  });

  const held = (over: Partial<HeldOffer>): HeldOffer => ({ id: 'a', propertyId: 'h', totalMinor: 30000, payAtPropertyMinor: 0, suggestedSellingMinor: null, rooms: 1, ...over });

  it('an anonymous visitor gets the cheapest combination that may be sold to them, not a member price', () => {
    const memberOnly = held({ id: 'a', totalMinor: 20000, suggestedSellingMinor: 21000 });
    const publicOk = held({ id: 'b', totalMinor: 25000, suggestedSellingMinor: 25000, rooms: 2 });
    expect(cheapestPerHotel([memberOnly, publicOk], 'public')).toEqual([publicOk]);
    expect(cheapestPerHotel([memberOnly, publicOk], 'member')).toEqual([memberOnly]);
    // Only a member price: it is still the hotel's candidate (shown as a member price, without its number).
    expect(cheapestPerHotel([memberOnly], 'public')).toEqual([memberOnly]);
  });

  it('counts what is paid at the hotel, then prefers fewer rooms, then the id: the same answer in any order', () => {
    const cheapTotal = held({ id: 'a', totalMinor: 30000, payAtPropertyMinor: 2400, rooms: 2 });
    const allInCheaper = held({ id: 'b', totalMinor: 31000, payAtPropertyMinor: 1200 });
    expect(cheapestPerHotel([cheapTotal, allInCheaper], 'member')).toEqual([allInCheaper]);
    const twoRooms = held({ id: 'a', rooms: 2 });
    const oneRoom = held({ id: 'z', rooms: 1 });
    expect(cheapestPerHotel([twoRooms, oneRoom], 'member')).toEqual([oneRoom]);
    expect(cheapestPerHotel([oneRoom, twoRooms], 'member')).toEqual([oneRoom]);
    expect(cheapestPerHotel([held({ id: 'b' }), held({ id: 'a' })], 'member')[0].id).toBe('a');
  });
});

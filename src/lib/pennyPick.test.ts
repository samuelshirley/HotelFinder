import { describe, expect, it } from 'vitest';

import { pennyLine, pennyPick, type PickRow } from './pennyPick';
import { SPONSORED_HOTELS } from './sponsors';

const row = (id: string, totalMinor: number, rating: number | null, km: number | null = 1): PickRow => ({
  propertyId: `p-${id}`,
  supplierHotelId: id,
  name: `Hotel ${id}`,
  totalMinor,
  currency: 'EUR',
  rating,
  km,
});

describe("Penny's pick", () => {
  const rows = [row('a', 20000, 8.4), row('b', 22000, 9.1), row('c', 30000, 9.6), row('d', 21900, 9.0), row('e', 40000, 9.9)];

  it('only when a lot fit', () => {
    expect(pennyPick(rows, 7, new Set())).toBeNull();
    expect(pennyPick(rows, 13, new Set())).not.toBeNull();
  });

  it('her own pick: the best rated of the top three within 15% of their cheapest, said with real numbers', () => {
    expect(pennyPick(rows, 13, new Set())).toEqual({ propertyId: 'p-b', name: 'Hotel b', sponsored: false, why: 'rated 9.1, €20 more than the cheapest of the top three' });
  });

  it('a paying hotel that is the same apple wins, and is labelled sponsored in the tag and the words', () => {
    const pick = pennyPick(rows, 13, new Set(['d']))!;
    expect(pick).toMatchObject({ propertyId: 'p-d', sponsored: true });
    expect(pennyLine(13, pick)).toContain('Sponsored: Hotel d');
  });

  it('a paying hotel that is not the same apple never wins: dearer, worse rated or further', () => {
    expect(pennyPick([...rows.slice(0, 3), row('x', 23200, 9.1)], 13, new Set(['x']))).toMatchObject({ propertyId: 'p-b', sponsored: false }); // 5.5% dearer
    expect(pennyPick([...rows.slice(0, 3), row('x', 22000, 8.8)], 13, new Set(['x']))).toMatchObject({ propertyId: 'p-b', sponsored: false }); // 0.3 lower
    expect(pennyPick([...rows.slice(0, 3), row('x', 22000, 9.1, 1.6)], 13, new Set(['x']))).toMatchObject({ propertyId: 'p-b', sponsored: false }); // 0.6 km further
  });

  it('her own pick being a paying hotel is still labelled', () => {
    expect(pennyPick(rows, 13, new Set(['b']))).toMatchObject({ propertyId: 'p-b', sponsored: true });
  });

  it('no hotel is sponsored until there is a real deal', () => {
    expect(SPONSORED_HOTELS.size).toBe(0);
  });
});

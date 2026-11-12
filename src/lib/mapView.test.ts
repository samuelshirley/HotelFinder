import { describe, expect, it } from 'vitest';

import { fitKeyFor, fitPoints, pinsFor, ringKmFor, ringPolygon, type MapPin } from './mapView';

const row = (id: string, rank: number, lat: number | null, lng: number | null, over: Record<string, unknown> = {}) => ({
  rank,
  source: 'finder',
  reason: { kind: 'best_balance', distance_km: 0.4 } as unknown,
  property: { id, name: `Hotel ${id}`, latitude: lat, longitude: lng },
  offer: { totalMinor: 26800, currency: 'EUR' } as { totalMinor: number; currency: string } | null,
  ...over,
});
const words = { money: (minor: number, currency: string) => `${currency} ${minor / 100}`, miss: () => 'Misses: no parking' };
const pin = (id: string, rank: number | null, latitude: number, longitude: number): MapPin => ({ id, rank, latitude, longitude, price: null, name: id, miss: null });

describe('rows become pins', () => {
  it('a ranked hotel carries its rank and its total from the offer row', () => {
    expect(pinsFor([row('a', 1, 41.14, -8.61)], words)).toEqual([{ id: 'a', latitude: 41.14, longitude: -8.61, rank: 1, price: 'EUR 268', name: 'Hotel a', miss: null }]);
  });

  it('a near-miss has no rank, and says what it misses', () => {
    const [p] = pinsFor([row('b', 6, 41.15, -8.6, { reason: { kind: 'near_miss', misses: [] } })], words);
    expect(p.rank).toBeNull();
    expect(p.miss).toBe('Misses: no parking');
  });

  it('a member-priced near-miss shows no price: its row holds no offer', () => {
    const [p] = pinsFor([row('c', 6, 41.15, -8.6, { reason: { kind: 'near_miss', misses: [{ kind: 'member_price' }] }, offer: null })], words);
    expect(p.price).toBeNull();
  });

  it('no location, or not ranked by the finder: no pin', () => {
    expect(pinsFor([row('d', 1, null, -8.6), row('e', 2, 41.1, null), row('f', 0, 41.1, -8.6, { source: 'user_named' })], words)).toEqual([]);
  });
});

describe('the distance ring', () => {
  const rows = [row('a', 1, 41.14, -8.61, { reason: { kind: 'closest', distance_km: 0.3 } }), row('b', 2, 41.14, -8.6, { reason: { kind: 'runner_up', distance_km: 0.8 } }), row('c', 6, 41.2, -8.5, { reason: { kind: 'near_miss', distance_km: 4 } })];

  it('reaches the furthest RANKED hotel, never a near-miss', () => {
    expect(ringKmFor(rows, { hasAnchor: true, closenessMatters: true })).toBe(0.8);
  });

  it('is not drawn unless closeness is part of the ranking and there is a place to measure from', () => {
    expect(ringKmFor(rows, { hasAnchor: true, closenessMatters: false })).toBeNull();
    expect(ringKmFor(rows, { hasAnchor: false, closenessMatters: true })).toBeNull();
  });

  it('is a closed circle starting due north, about the right size', () => {
    const ring = ringPolygon({ latitude: 41.14, longitude: -8.61 }, 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][0]).toBeCloseTo(-8.61, 6);
    expect((ring[0][1] - 41.14) * 110.574).toBeCloseTo(1, 3);
  });
});

describe('what the camera frames', () => {
  const ranked = [pin('a', 1, 41.14, -8.615), pin('b', 2, 41.145, -8.605)];

  it('the ranked hotels and the anchor', () => {
    expect(fitPoints(ranked, { latitude: 41.141, longitude: -8.61 })).toHaveLength(3);
  });

  it('a near-miss next door joins; one across town does not', () => {
    const near = pin('m1', null, 41.1455, -8.6048);
    const far = pin('m2', null, 41.2, -8.5);
    const framed = fitPoints([...ranked, near, far], null);
    expect(framed).toContain(near);
    expect(framed).not.toContain(far);
  });

  it('only near-misses on the list: frame those', () => {
    const misses = [pin('m1', null, 41.14, -8.61), pin('m2', null, 41.15, -8.6)];
    expect(fitPoints(misses, null)).toEqual(misses);
  });
});

describe('when the camera may move', () => {
  const a = pin('a', 1, 41.14, -8.615);
  const b = pin('b', 2, 41.145, -8.605);

  it('a re-rank of the same hotels keeps the key, so the camera stays put', () => {
    expect(fitKeyFor([a, b], null)).toBe(fitKeyFor([{ ...b, rank: 1 }, { ...a, rank: 2 }], null));
  });

  it('a different set, or a new anchor, changes it', () => {
    expect(fitKeyFor([a], null)).not.toBe(fitKeyFor([a, b], null));
    expect(fitKeyFor([a, b], { latitude: 41.14, longitude: -8.61 })).not.toBe(fitKeyFor([a, b], null));
  });
});

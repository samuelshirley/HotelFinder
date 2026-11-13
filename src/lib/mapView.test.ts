import { describe, expect, it } from 'vitest';

import { layoutPins, fitKeyFor, fitPoints, framePadding, PIN_HALF_PX, STACK_OFFSETS, COMPACT_PX, pinsFor, ringKmFor, ringPolygon, type MapPin } from './mapView';

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

  it('with the full list open, the page on screen alone, not the picks or the anchor', () => {
    const page = [pin('p6', 6, 41.146, -8.611), pin('p7', 7, 41.148, -8.609)];
    const airport = pin('a1', 1, 41.237, -8.67);
    expect(fitPoints([airport, ...ranked, ...page], { latitude: 41.24, longitude: -8.67 }, ['p6', 'p7'])).toEqual(page);
    // A page whose hotels have no pin (no location): the usual frame.
    expect(fitPoints([...ranked], null, ['p9'])).toEqual(ranked);
    expect(fitPoints([...ranked], null, [])).toEqual(ranked);
  });
});

describe('a row of the full list becomes a ranked pin', () => {
  it('with its rank and its total, like a top pick', () => {
    const [p] = pinsFor([row('t', 14, 41.15, -8.61, { reason: { kind: 'full_list', distance_km: 1.2, per_night_minor: 13400 } })], words);
    expect(p).toMatchObject({ rank: 14, price: 'EUR 268', miss: null });
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

  it('another page of the full list changes it; the same page in another order does not', () => {
    expect(fitKeyFor([a, b], null, ['b'])).not.toBe(fitKeyFor([a, b], null, ['a']));
    expect(fitKeyFor([a, b], null, ['a', 'b'])).toBe(fitKeyFor([a, b], null, ['b', 'a']));
    expect(fitKeyFor([a, b], null, [])).toBe(fitKeyFor([a, b], null));
  });
});

describe('labels never cover each other', () => {
  const box = (id: string, rank: number | null, x: number, y: number) => ({ id, rank, x, y, width: 102, height: 28 });
  const rects = (boxes: ReturnType<typeof box>[], view: { width: number; height: number } | null = null) => {
    const places = layoutPins(boxes, view);
    return boxes.flatMap((b) => {
      const p = places.get(b.id);
      return p ? [{ id: b.id, x: b.x + p.dx, y: b.y + p.dy, w: p.compact ? 28 : b.width, h: b.height }] : [];
    });
  };
  const overlapping = (rs: ReturnType<typeof rects>) =>
    rs.flatMap((a, i) => rs.slice(i + 1).filter((b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h).map((b) => `${a.id}+${b.id}`));

  it('the Porto case: 2 under 3, and 1, 4 and 5 within 12 px — all five readable, the better rank where it belongs', () => {
    // Centres as measured in the browser on 12 Nov 2026.
    const boxes = [box('p1', 1, 610, 403), box('p2', 2, 538, 256), box('p3', 3, 540, 258), box('p4', 4, 609, 393), box('p5', 5, 612, 405)];
    const places = layoutPins(boxes);
    expect(places.get('p1')).toEqual({ dx: 0, dy: 0, compact: false });
    expect(places.get('p2')).toEqual({ dx: 0, dy: 0, compact: false });
    expect([...places.values()].every((p) => !p.compact)).toBe(true);
    expect(overlapping(rects(boxes))).toEqual([]);
  });

  it('pins apart stay exactly where their hotels are', () => {
    const places = layoutPins([box('a', 1, 100, 100), box('b', 2, 300, 100), box('c', 3, 100, 140)]);
    expect([...places.values()]).toEqual([{ dx: 0, dy: 0, compact: false }, { dx: 0, dy: 0, compact: false }, { dx: 0, dy: 0, compact: false }]);
  });

  it('more hotels on one spot than there are slots: the rest show their rank alone', () => {
    const boxes = Array.from({ length: 7 }, (_, i) => box(`h${i + 1}`, i + 1, 200, 200));
    const places = layoutPins(boxes);
    expect(boxes.filter((b) => !places.get(b.id)!.compact).map((b) => b.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
    expect(places.get('h6')!.compact).toBe(true);
  });

  it('a label moved to make room stays inside the map: near the bottom edge it stacks above, not past the edge', () => {
    // The band in e2e/map.spec is 274 px tall; the fit leaves 72 px around the hotels,
    // so a hotel can sit 72 px from the bottom, and 64 px below that is outside.
    const view = { width: 1360, height: 274 };
    const boxes = [box('a', 1, 600, 202), box('b', 2, 600, 202), box('c', 3, 600, 202), box('d', 4, 600, 202)];
    const rs = rects(boxes, view);
    expect(overlapping(rs)).toEqual([]);
    for (const r of rs) {
      expect(r.y - r.h / 2).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h / 2).toBeLessThanOrEqual(view.height);
    }
    // Without the edge the same pile used the slot past it.
    expect(rects(boxes).some((r) => r.y + r.h / 2 > view.height)).toBe(true);
  });

  it('a rank alone that would still cover a pin steps aside instead (Porto, 13 Nov 2026: 4 under 5)', () => {
    const view = { width: 1360, height: 274 };
    // Seven on one spot: five full labels fill the stack, the last two are ranks alone, beside it.
    const boxes = Array.from({ length: 7 }, (_, i) => box(`h${i + 1}`, i + 1, 600, 137));
    const rs = rects(boxes, view);
    expect(overlapping(rs)).toEqual([]);
    expect(rs.filter((r) => r.w === 28).map((r) => r.id)).toEqual(['h6', 'h7']);
    for (const r of rs) expect(r.x - r.w / 2).toBeGreaterThanOrEqual(0);
  });

  it('a hotel near the edge keeps its own spot: the camera, not the layout, decides where it is', () => {
    const places = layoutPins([box('a', 1, 600, 268)], { width: 1360, height: 274 });
    expect(places.get('a')).toEqual({ dx: 0, dy: 0, compact: false });
  });

  it('near-misses are rings, not labels: never moved, never in the way', () => {
    const places = layoutPins([box('m', null, 100, 100), box('a', 1, 100, 100)]);
    expect(places.has('m')).toBe(false);
    expect(places.get('a')).toEqual({ dx: 0, dy: 0, compact: false });
  });
});

describe('framePadding', () => {
  it('keeps a label stacked furthest below or above its hotel inside the map', () => {
    const p = framePadding(700, 600);
    const reach = Math.max(...STACK_OFFSETS.map(Math.abs)) + PIN_HALF_PX;
    expect(p.top).toBeGreaterThan(reach);
    expect(p.bottom).toBeGreaterThan(reach);
    expect(p.left).toBe(72);
  });
  it('never takes more than a third of a side, so MapLibre can still fit', () => {
    const p = framePadding(150, 200);
    expect(p.top + p.bottom).toBeLessThan(200);
    expect(p.left + p.right).toBeLessThan(150);
  });
});

describe('layoutPins in a crowd', () => {
  // The five central Porto hotels seen on CI (2026-11-13): no slot above or below was free for rank 5.
  const box = (id: string, rank: number, x: number, y: number, width = 100) => ({ id, rank, x, y, width, height: 28 });
  const boxes = [box('1', 1, 581, 330), box('2', 2, 552, 361), box('3', 3, 589, 300), box('4', 4, 591, 232), box('5', 5, 573, 279)];
  it('sets a rank alone beside the stack rather than on another label', () => {
    const places = layoutPins(boxes);
    const rects = boxes.map((b) => {
      const p = places.get(b.id)!;
      const w = p.compact ? COMPACT_PX : b.width;
      return { x: b.x + p.dx - w / 2, y: b.y + p.dy - 14, w, h: 28 };
    });
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${i + 1} and ${j + 1}`).toBe(false);
      }
    expect(places.get('5')!.compact).toBe(true);
    expect(places.get('5')!.dx).not.toBe(0);
  });
});

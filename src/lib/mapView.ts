/**
 * The pure half of the map (components/MapPanel.tsx): which rows become pins,
 * what the camera fits, and the distance ring. No map library here, so every
 * rule is unit-tested (mapView.test.ts). Design and the reasons: docs/design/map.md.
 */

export type MapPoint = { latitude: number; longitude: number };

export type MapPin = MapPoint & {
  /** The property id: the join key to the list. */
  id: string;
  /** null = a near-miss: drawn as a hollow ring, never given a rank. */
  rank: number | null;
  /** Total for the stay, already formatted from the offer row. null = no price may be shown. */
  price: string | null;
  name: string;
  /** What a near-miss misses, in the card's own words. */
  miss: string | null;
};

type RowLike = {
  rank: number;
  source: string;
  reason: unknown;
  property: { id: string; name: string; latitude: number | null; longitude: number | null };
  offer: { totalMinor: number; currency: string } | null;
};

const isNearMiss = (row: RowLike) => (row.reason as { kind?: unknown } | null)?.kind === 'near_miss';

/**
 * One pin per finder row that has a location. A hotel the user only asked
 * about (not ranked by the finder) gets no pin: the map shows the ranking.
 */
export function pinsFor(rows: readonly RowLike[], words: { money: (minor: number, currency: string) => string; miss: (row: RowLike) => string }): MapPin[] {
  return rows.flatMap((row): MapPin[] => {
    const { latitude, longitude } = row.property;
    if (row.source !== 'finder' || latitude === null || longitude === null) return [];
    const miss = isNearMiss(row);
    return [
      {
        id: row.property.id,
        latitude,
        longitude,
        rank: miss ? null : row.rank,
        price: row.offer ? words.money(row.offer.totalMinor, row.offer.currency) : null,
        name: row.property.name,
        miss: miss ? words.miss(row) || null : null,
      },
    ];
  });
}

/**
 * The ring's radius: the furthest ranked hotel's distance from the anchor, as
 * the finder measured it. null unless closeness is part of the ranking and
 * there is a real place to measure from.
 */
export function ringKmFor(rows: readonly RowLike[], opts: { hasAnchor: boolean; closenessMatters: boolean }): number | null {
  if (!opts.hasAnchor || !opts.closenessMatters) return null;
  const kms = rows.flatMap((row) => {
    if (row.source !== 'finder' || isNearMiss(row)) return [];
    const km = (row.reason as { distance_km?: unknown } | null)?.distance_km;
    return typeof km === 'number' && Number.isFinite(km) && km > 0 ? [km] : [];
  });
  return kms.length ? Math.max(...kms) : null;
}

const span = (points: readonly MapPoint[]) => {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  return (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
};

/** Near-misses join the fit only while they grow the framed area by less than this. */
export const MISS_GROWTH_MAX = 0.3;

/**
 * What the camera frames: the ranked hotels and the anchor. A near-miss is
 * included only if it barely widens the frame; one far-off miss must not
 * shrink the hotels that fit into a cluster of overlapping pins.
 */
export function fitPoints(pins: readonly MapPin[], anchor: MapPoint | null): MapPoint[] {
  const core: MapPoint[] = [...pins.filter((p) => p.rank !== null), ...(anchor ? [anchor] : [])];
  const misses = pins.filter((p) => p.rank === null);
  if (core.length === 0) return misses;
  const out = [...core];
  for (const miss of misses) {
    const before = span(out);
    const after = span([...out, miss]);
    // A single point has no area: compare against a small floor (about 300 m square).
    const base = Math.max(before, 0.003 * 0.003);
    if ((after - before) / base < MISS_GROWTH_MAX) out.push(miss);
  }
  return out;
}

/**
 * Changes when the SET of hotels or the anchor changes, not when their order
 * does: a re-rank of the same hotels must leave the camera alone.
 */
export function fitKeyFor(pins: readonly MapPin[], anchor: MapPoint | null): string {
  return `${[...pins.map((p) => p.id)].sort().join(',')}|${anchor ? `${anchor.latitude.toFixed(5)},${anchor.longitude.toFixed(5)}` : ''}`;
}

/** A circle of `km` around a point as [lng, lat] pairs, starting due north, closed. */
export function ringPolygon(centre: MapPoint, km: number, steps = 64): Array<[number, number]> {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((centre.latitude * Math.PI) / 180));
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([centre.longitude + dLng * Math.sin(a), centre.latitude + dLat * Math.cos(a)]);
  }
  return ring;
}

export type PinBox = { id: string; rank: number | null; x: number; y: number; width: number; height: number };
export type PinPlace = { dx: number; dy: number; compact: boolean };

/** A pin drawn small: just its rank, in a circle this wide. */
export const COMPACT_PX = 28;
/** Where a label that would cover another is tried instead, in order: just below, just above, then one further each way. */
export const STACK_OFFSETS = [32, -32, 64, -64] as const;
/** Where a rank alone is tried beside the stack when nothing above or below is free: clear of a full label on either side. */
export const SIDE_OFFSETS = [44, -44, 72, -72] as const;
/** Half a pin label's height, its 2 px ring included (MapPanel.module.css `.pin`). */
export const PIN_HALF_PX = 15;

/**
 * How far the camera keeps the hotels from the map's edges. A label can sit the
 * furthest stack offset below or above its hotel, so the top and bottom keep
 * that much plus half a label and a margin; seen in the browser (2026-11-13),
 * a uniform 72 px left rank 5's label 6 px below the map, under the credits.
 * Never more than a third of a side: MapLibre does not move at all when the
 * padding leaves no room.
 */
export function framePadding(width: number, height: number): { top: number; bottom: number; left: number; right: number } {
  const v = Math.floor(Math.min(Math.max(...STACK_OFFSETS.map(Math.abs)) + PIN_HALF_PX + 9, height / 3));
  // The sides keep a rank alone set beside a stack (SIDE_OFFSETS) inside too.
  const h = Math.floor(Math.min(Math.max(...SIDE_OFFSETS.map(Math.abs)) + COMPACT_PX / 2 + 2, width / 3));
  return { top: v, bottom: v, left: h, right: h };
}

/**
 * Where each label goes so that no two cover each other. Seen in the browser
 * on the first real search (Porto, 12 Nov 2026): "2 · €119" sat entirely
 * under "3 · €125", and three hotels 10 px apart were one unreadable pile, so
 * pressing a pin selected the wrong hotel.
 *
 * Better ranks are placed first, on their own spot. A label that would touch
 * one already placed is stacked just below or above it (hotels in one street
 * read as a stack, and zooming in pulls them apart). Only when no slot is
 * free does it shrink to its rank alone; the price comes back on hover.
 * `x`,`y` are the pin's centre on screen, `width` its full label.
 */
export function layoutPins(boxes: readonly PinBox[], gap = 2): Map<string, PinPlace> {
  const order = [...boxes].filter((b) => b.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const out = new Map<string, PinPlace>();
  const free = (x: number, y: number, w: number, h: number) =>
    !placed.some((p) => Math.abs(p.x - x) * 2 < p.w + w + gap * 2 && Math.abs(p.y - y) * 2 < p.h + h + gap * 2);
  for (const b of order) {
    const dy = [0, ...STACK_OFFSETS].find((d) => free(b.x, b.y + d, b.width, b.height));
    if (dy !== undefined) {
      out.set(b.id, { dx: 0, dy, compact: false });
      placed.push({ x: b.x, y: b.y + dy, w: b.width, h: b.height });
      continue;
    }
    // A rank alone: above or below first, then beside the stack. Seen on CI (2026-11-13): five central
    // hotels left no slot above or below, and "5" fell back onto "3 · €268".
    const slots = [0, ...SIDE_OFFSETS].flatMap((dx) => [0, ...STACK_OFFSETS].map((dy) => ({ dx, dy })));
    const small = slots.find((p) => free(b.x + p.dx, b.y + p.dy, COMPACT_PX, b.height)) ?? { dx: 0, dy: 0 };
    out.set(b.id, { ...small, compact: true });
    placed.push({ x: b.x + small.dx, y: b.y + small.dy, w: COMPACT_PX, h: b.height });
  }
  return out;
}

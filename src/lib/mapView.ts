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
 *
 * `frame`: with the full list open, the page on screen (lib/fullList.ts). The
 * camera frames those hotels alone, so a page of twenty is readable; framed
 * with the top picks and the anchor, a city's worth of them was one pile of
 * rank circles (measured in e2e/full-list.spec.ts, Porto, 13 Nov 2026).
 */
export function fitPoints(pins: readonly MapPin[], anchor: MapPoint | null, frame: readonly string[] | null = null): MapPoint[] {
  const page = frame ? pins.filter((p) => frame.includes(p.id)) : [];
  if (page.length > 0) return page;
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
export function fitKeyFor(pins: readonly MapPin[], anchor: MapPoint | null, frame: readonly string[] | null = null): string {
  const framed = frame && frame.length ? `|${[...frame].sort().join(',')}` : '';
  return `${[...pins.map((p) => p.id)].sort().join(',')}|${anchor ? `${anchor.latitude.toFixed(5)},${anchor.longitude.toFixed(5)}` : ''}${framed}`;
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
/** A rank alone that still covers another steps aside: past another rank alone, then past a full label, left before right. */
const sideOffsets = (labelWidth: number) => [-(COMPACT_PX + 4), COMPACT_PX + 4, -(labelWidth / 2 + COMPACT_PX / 2 + 4), labelWidth / 2 + COMPACT_PX / 2 + 4];

/**
 * Where each label goes so that no two cover each other. Seen in the browser
 * on the first real search (Porto, 12 Nov 2026): "2 · €119" sat entirely
 * under "3 · €125", and three hotels 10 px apart were one unreadable pile, so
 * pressing a pin selected the wrong hotel.
 *
 * Better ranks are placed first, on their own spot. A label that would touch
 * one already placed is stacked just below or above it (hotels in one street
 * read as a stack, and zooming in pulls them apart). Only when no slot is
 * free does it shrink to its rank alone; the price comes back on hover. A
 * rank alone that still touches one steps aside, left or right.
 *
 * A moved label stays inside the map (`view`): stacking 64 px below a hotel
 * near the bottom edge put the label past it (e2e/map.spec, 13 Nov 2026). A
 * label on its own hotel's spot is always allowed; the camera decides that.
 * `x`,`y` are the pin's centre on screen, `width` its full label.
 */
export function layoutPins(boxes: readonly PinBox[], view: { width: number; height: number } | null = null, gap = 2): Map<string, PinPlace> {
  const order = [...boxes].filter((b) => b.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const out = new Map<string, PinPlace>();
  const free = (x: number, y: number, w: number, h: number) =>
    !placed.some((p) => Math.abs(p.x - x) * 2 < p.w + w + gap * 2 && Math.abs(p.y - y) * 2 < p.h + h + gap * 2);
  const inside = (x: number, y: number, w: number, h: number) => !view || (x - w / 2 >= 0 && x + w / 2 <= view.width && y - h / 2 >= 0 && y + h / 2 <= view.height);
  const fits = (b: PinBox, dx: number, dy: number, w: number) => free(b.x + dx, b.y + dy, w, b.height) && ((dx === 0 && dy === 0) || inside(b.x + dx, b.y + dy, w, b.height));
  const place = (b: PinBox, dx: number, dy: number, compact: boolean) => {
    out.set(b.id, { dx, dy, compact });
    placed.push({ x: b.x + dx, y: b.y + dy, w: compact ? COMPACT_PX : b.width, h: b.height });
  };
  for (const b of order) {
    const dy = [0, ...STACK_OFFSETS].find((d) => fits(b, 0, d, b.width));
    if (dy !== undefined) {
      place(b, 0, dy, false);
      continue;
    }
    let spot: [number, number] | undefined;
    for (const dx of [0, ...sideOffsets(b.width)]) {
      const d = [0, ...STACK_OFFSETS].find((y) => fits(b, dx, y, COMPACT_PX));
      if (d !== undefined) {
        spot = [dx, d];
        break;
      }
    }
    place(b, spot?.[0] ?? 0, spot?.[1] ?? 0, true);
  }
  return out;
}

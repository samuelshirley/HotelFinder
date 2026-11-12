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

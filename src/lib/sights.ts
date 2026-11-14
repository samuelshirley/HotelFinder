import { z } from 'zod';

import { haversineKm, medianPoint, type LatLng } from '@/lib/finder/geo';

/**
 * Sights: "I want to tour some museums" (docs/sights.md). Pure.
 *
 * The user names a KIND of sight; a model or Jev only ever picks the kind from
 * this closed list. Which places they are, where they are and how well known
 * they are comes from Google Places rows (server/sights/), never from a model.
 * From those rows, code picks the most popular, measures "close" from the
 * middle of them, and lays the days out.
 */
export const SIGHT_KINDS = ['museums', 'galleries'] as const;
export type SightKind = (typeof SIGHT_KINDS)[number];
export const isSightKind = (v: unknown): v is SightKind => (SIGHT_KINDS as readonly unknown[]).includes(v);

/**
 * Google's PRIMARY place types for each kind. Primary, not "included": asking
 * for places that merely include `museum` returned churches and port cellars
 * for Porto (Torre dos Clérigos, Caves Cálem; 2026-11-13).
 */
export const GOOGLE_PRIMARY_TYPES: Record<SightKind, readonly string[]> = {
  museums: ['museum', 'art_museum', 'history_museum'],
  galleries: ['art_gallery'],
};

/** How far from the destination's point a sight may be, and the radius asked of Google. */
export const SIGHTS_RADIUS_M = 8_000;

export type Sight = {
  /** Google's place id: the one thing its terms let us keep for good. */
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Out of 5, from Google. */
  rating: number;
  reviewCount: number;
};

/** What a stay holds: the kind asked for and the places found, most popular first. */
export type StaySights = { kind: SightKind; places: Sight[] };

const placeSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string().min(1) }),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  businessStatus: z.string().optional(),
  primaryType: z.string().optional(),
});

/**
 * A Places (New) search response → the places in it we can use. One malformed
 * place is skipped, not fatal. A place that is closed, or that Google gives no
 * rating for, is left out: with no rating there is nothing to call it popular on.
 */
export function parsePlaces(json: unknown, kind: SightKind): Sight[] {
  const list = (json as { places?: unknown } | null)?.places;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Sight[] = [];
  for (const raw of list) {
    const p = placeSchema.safeParse(raw);
    if (!p.success) continue;
    const v = p.data;
    if (v.businessStatus !== undefined && v.businessStatus !== 'OPERATIONAL') continue;
    if (v.primaryType !== undefined && !GOOGLE_PRIMARY_TYPES[kind].includes(v.primaryType)) continue;
    if (v.rating === undefined || v.userRatingCount === undefined) continue;
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({ placeId: v.id, name: v.displayName.text, latitude: v.location.latitude, longitude: v.location.longitude, rating: v.rating, reviewCount: v.userRatingCount });
  }
  return out;
}

/** Well rated: at least this out of 5. */
export const MIN_SIGHT_RATING = 4;
/** Enough reviews for the rating to mean something. */
export const MIN_SIGHT_REVIEWS = 50;
/** The most a stay holds, and the most a plan uses. */
export const MAX_SIGHTS = 8;
export const MIN_SIGHTS = 2;
/** A day of sightseeing: this many, at most. */
export const SIGHTS_PER_DAY = 2;

/**
 * "The most popular": well rated (4.0 or more from at least 50 reviews), then
 * the most reviewed first. The review count is the measure of how well known a
 * place is; the rating is only a floor, so a 4.9 from 60 people never outranks
 * a 4.4 from 7,000. Ties: the higher rating, then the name, so the order never
 * depends on the order Google sent.
 */
export function pickSights(found: readonly Sight[], centre: LatLng | null): Sight[] {
  return found
    .filter((s) => s.rating >= MIN_SIGHT_RATING && s.reviewCount >= MIN_SIGHT_REVIEWS)
    .filter((s) => centre === null || haversineKm(centre, s) * 1000 <= SIGHTS_RADIUS_M)
    .sort((a, b) => b.reviewCount - a.reviewCount || b.rating - a.rating || a.name.localeCompare(b.name) || a.placeId.localeCompare(b.placeId))
    .slice(0, MAX_SIGHTS);
}

/** How many sights a stay of this many nights has time for: two a day, never fewer than three. */
export function sightCount(nights: number): number {
  return Math.min(MAX_SIGHTS, Math.max(3, Math.max(1, nights) * SIGHTS_PER_DAY));
}

/** The sights this stay uses: the most popular, as many as its nights have time for. */
export function sightsInPlay(sights: StaySights, nights: number): Sight[] {
  return sights.places.slice(0, sightCount(nights));
}

/** What "close" is measured from: the middle of the sights in play (median latitude and longitude). */
export function sightsCentre(sights: StaySights, nights: number): LatLng | null {
  return medianPoint(sightsInPlay(sights, nights));
}

/** The stand-in place id for "close to the sights": compared, never sent to a supplier. */
export const sightsPlaceId = (kind: SightKind) => `sights:${kind}`;
export const isSightsPlaceId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith('sights:');

/** The label stored with the point (English; the view and the replies word it per language from the kind). */
export const SIGHTS_LABEL: Record<SightKind, string> = { museums: 'the museums', galleries: 'the galleries' };

/** One sight on Google Maps. Built from the place id: no key, no call. */
export function sightMapsUrl(s: Pick<Sight, 'placeId' | 'name'>): string {
  const q = new URLSearchParams({ api: '1', query: s.name, query_place_id: s.placeId });
  return `https://www.google.com/maps/search/?${q.toString()}`;
}

export type PlanStop = Sight & {
  /** Straight line from the stop before (the hotel, for the first), in km. */
  legKm: number;
};
export type PlanDay = {
  day: number;
  stops: PlanStop[];
  /** Hotel → each stop in order, straight line, in km. Not a walking route: the link gives that. */
  totalKm: number;
  /** Google Maps walking directions from the hotel through the day's stops. */
  routeUrl: string;
};

const round1 = (km: number) => Math.round(km * 10) / 10;

/** Compass bearing from a to b, 0–360. Good enough at city scale. */
function bearing(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * A day-by-day plan from one hotel. Deterministic, from coordinates alone:
 *
 *  - days: one per night, fewer when there are not two sights for each;
 *  - which day: sights in the same direction from the hotel go together (sorted
 *    by bearing, the circle cut at its widest gap, then split into equal runs),
 *    so no day crosses the town twice;
 *  - order within a day: the nearest next, starting from the hotel;
 *  - day order: the shortest day first.
 *
 * Distances are straight lines. The route link hands the real walk to Google
 * Maps; nothing here claims a walking time.
 */
export function walkingPlan(hotel: LatLng & { name?: string }, sights: readonly Sight[], nights: number): PlanDay[] {
  if (sights.length === 0) return [];
  const dayCount = Math.max(1, Math.min(Math.max(1, nights), Math.ceil(sights.length / SIGHTS_PER_DAY)));

  const around = sights
    .map((s) => ({ s, at: bearing(hotel, s) }))
    .sort((a, b) => a.at - b.at || a.s.placeId.localeCompare(b.s.placeId));
  // Start after the widest empty arc, so a run never jumps across it.
  let start = 0;
  let widest = -1;
  for (let i = 0; i < around.length; i++) {
    const prev = around[(i - 1 + around.length) % around.length].at;
    const gap = (around[i].at - prev + 360) % 360 || (around.length === 1 ? 360 : 0);
    if (gap > widest) {
      widest = gap;
      start = i;
    }
  }
  const ring = around.map((_, i) => around[(start + i) % around.length].s);

  const groups: Sight[][] = [];
  for (let d = 0, from = 0; d < dayCount; d++) {
    const size = Math.ceil((ring.length - from) / (dayCount - d));
    groups.push(ring.slice(from, from + size));
    from += size;
  }

  const days = groups
    .filter((g) => g.length > 0)
    .map((group) => {
      const left = [...group];
      const stops: PlanStop[] = [];
      let here: LatLng = hotel;
      while (left.length > 0) {
        let best = 0;
        for (let i = 1; i < left.length; i++) {
          const d = haversineKm(here, left[i]) - haversineKm(here, left[best]);
          if (d < 0 || (d === 0 && left[i].placeId < left[best].placeId)) best = i;
        }
        const [next] = left.splice(best, 1);
        stops.push({ ...next, legKm: round1(haversineKm(here, next)) });
        here = next;
      }
      return { stops, totalKm: round1(stops.reduce((sum, s) => sum + s.legKm, 0)) };
    })
    .sort((a, b) => a.totalKm - b.totalKm || a.stops[0].placeId.localeCompare(b.stops[0].placeId));

  return days.map((d, i) => ({ day: i + 1, stops: d.stops, totalKm: d.totalKm, routeUrl: routeUrl(hotel, d.stops) }));
}

/**
 * Google Maps directions, on foot, from the hotel through the stops (Maps URLs:
 * developers.google.com/maps/documentation/urls/get-started). The hotel is its
 * coordinates (a name could resolve to another hotel); each sight is its name
 * pinned by its place id.
 */
export function routeUrl(hotel: LatLng, stops: ReadonlyArray<Pick<Sight, 'placeId' | 'name'>>): string {
  const last = stops[stops.length - 1];
  const via = stops.slice(0, -1);
  const q = new URLSearchParams({ api: '1', origin: `${hotel.latitude},${hotel.longitude}`, destination: last.name, destination_place_id: last.placeId, travelmode: 'walking' });
  if (via.length > 0) {
    q.set('waypoints', via.map((s) => s.name.replace(/\|/g, ' ')).join('|'));
    q.set('waypoint_place_ids', via.map((s) => s.placeId).join('|'));
  }
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** The stored value, checked on the way out of the database: anything else is "no sights". */
const staySightsSchema = z.object({
  kind: z.enum(SIGHT_KINDS),
  places: z
    .array(z.object({ placeId: z.string().min(1), name: z.string().min(1), latitude: z.number(), longitude: z.number(), rating: z.number(), reviewCount: z.number() }))
    .min(1)
    .max(MAX_SIGHTS),
});
export function readStaySights(value: unknown): StaySights | null {
  const parsed = staySightsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

import type { LatLng } from './geo';
import type { NearTarget } from './rank';

/**
 * Where to search and where "close" is measured from. Pure.
 *
 * Measured in the sandbox on 2026-11-11 (docs/onboarding.md §3.4): a rate
 * search by Barcelona airport's place id returned 30 hotels, 1 of them within
 * 9 km of the airport (median 12.3 km: central Barcelona). A 6 km radius
 * around the airport's point returned 23, all within 6.8 km. So when the
 * user wants to be near a POINT, the search must be a radius around it.
 *
 * For an AREA (a city) with nothing named, "close" is measured from the
 * middle of the hotels the search returned, NOT from the city's map point.
 * Measured on the recordings: Porto's map point is 1.8–2.3 km from Aliados,
 * the Sé and Ribeira; the middle of its 20 hotels is 0.3–0.5 km from them.
 * Annecy: 0.73 km (map point) vs 0.56 km (middle) from the old town.
 */
export const RADIUS_M = 5_000;
export const WIDE_RADIUS_M = 15_000;
/** Fewer hotels than this in the first radius: widen once. */
export const MIN_HOTELS = 10;

export type PlanInput = {
  destinationText: string;
  placeId: string | null;
  destPoint: LatLng | null;
  destKind: 'area' | 'point' | null;
  near: { label: string; latitude: number; longitude: number } | null;
};

export type SearchWhere = { placeId: string } | { latitude: number; longitude: number; radiusM: number };

export type SearchPlan =
  | { kind: 'place'; where: { placeId: string }; target: NearTarget | null }
  | { kind: 'radius'; where: { latitude: number; longitude: number; radiusM: number }; wider: { latitude: number; longitude: number; radiusM: number }; target: NearTarget };

export function planSearch(input: PlanInput): SearchPlan | null {
  if (input.near) {
    const point = { latitude: input.near.latitude, longitude: input.near.longitude };
    return radius(point, { point, label: input.near.label, from: 'place' });
  }
  if (input.destKind === 'point' && input.destPoint) {
    return radius(input.destPoint, { point: input.destPoint, label: placeName(input.destinationText), from: 'destination' });
  }
  if (!input.placeId) return null;
  // An area: the ranking measures from the middle of what comes back (target null).
  return { kind: 'place', where: { placeId: input.placeId }, target: null };
}

function radius(point: LatLng, target: NearTarget): SearchPlan {
  return {
    kind: 'radius',
    where: { ...point, radiusM: RADIUS_M },
    wider: { ...point, radiusM: WIDE_RADIUS_M },
    target,
  };
}

/** "Annecy, France" → "Annecy". The first part of the label the user picked. */
export function placeName(destinationText: string): string {
  return destinationText.split(',')[0].trim() || destinationText;
}

/** What "close" means for an area when the user named nothing: the middle of its hotels, called its centre. */
export function centreLabel(destinationText: string): string {
  return `central ${placeName(destinationText)}`;
}

/** Place types that make a destination one point rather than an area. */
const POINT_TYPES = ['airport', 'train_station', 'transit_station', 'subway_station', 'bus_station', 'point_of_interest', 'establishment', 'premise'];
const AREA_TYPES = ['locality', 'sublocality', 'neighborhood', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'postal_town', 'colloquial_area', 'country', 'political'];

/** An area (search the place) or a point (search a radius around it). An area type wins: "Porto" is political AND geocode. */
export function destinationKind(types: readonly string[]): 'area' | 'point' {
  if (types.some((t) => AREA_TYPES.includes(t))) return 'area';
  return types.some((t) => POINT_TYPES.includes(t)) ? 'point' : 'area';
}

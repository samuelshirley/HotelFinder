import type { Amenity } from '@/lib/amenities';

/**
 * LiteAPI facility ids behind each amenity, read from /data/facilities on
 * 2026-11-11 (820 entries). An amenity is present when the hotel lists ANY of
 * its ids. Names in comments are the supplier's own.
 */
export const FACILITY_IDS: Record<Amenity, readonly number[]> = {
  pets_allowed: [4], // Pets allowed
  parking: [2, 46, 52, 161, 181], // Parking, Free Parking, Valet parking, Private parking, Parking garage
  free_parking: [46], // Free Parking
  pool: [301, 103, 104, 120, 122, 192, 193], // Swimming pool, Indoor, Outdoor, seasonal ×2, Rooftop, Infinity
  air_conditioning: [109], // Air conditioning
  wifi: [47, 107], // WiFi available, Free WiFi
  lift: [48, 491], // Lift / Elevator, Elevator
  wheelchair_accessible: [185], // Wheelchair accessible
  family_rooms: [28], // Family rooms
  soundproof_rooms: [64], // Soundproof rooms
  fitness: [11, 492], // Fitness center, Fitness facilities
  airport_shuttle: [17, 139, 140], // Airport shuttle, (free), (additional charge)
};

export function amenitiesFromFacilityIds(ids: readonly number[]): Amenity[] {
  const have = new Set(ids);
  return (Object.keys(FACILITY_IDS) as Amenity[]).filter((a) => FACILITY_IDS[a].some((id) => have.has(id)));
}

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

/**
 * Whether a hotel takes pets, read from the three places LiteAPI's details
 * say it, which disagree (docs/supplier.md, "Pets"). Measured on 48 hotels,
 * 2026-11-13: `petsAllowed` is true only when a structured pet policy
 * exists, and is false for most hotels whose facility list says "Pets
 * allowed", so a false flag alone means "not stated", not "no".
 *
 * - An explicit "not allowed" policy wins over everything (Hilton Porto
 *   Gaia lists the facility AND says "Pets are not allowed.").
 * - Any positive: the flag, the facility, or a policy saying they are allowed.
 * - Otherwise null: the listing does not say.
 */
export function petsFromListing(listing: {
  flag: boolean | null | undefined;
  facilities: readonly string[];
  policies: readonly { policy_type?: string | null; name?: string | null; description?: string | null }[];
}): boolean | null {
  const petPolicies = listing.policies
    .filter((p) => p.policy_type === 'POLICY_HOTEL_PETS' || /\bpets?\b/i.test(p.name ?? ''))
    .map((p) => (p.description ?? '').trim());
  if (petPolicies.some((d) => /\b(pets?\s+(are\s+)?not\s+allowed|no\s+pets)\b/i.test(d))) return false;
  if (listing.flag === true) return true;
  if (listing.facilities.some((f) => /^pets allowed$/i.test(f.trim()))) return true;
  if (petPolicies.some((d) => /^pets\s+(are\s+)?allowed\b/i.test(d))) return true;
  return null;
}

export function amenitiesFromFacilityIds(ids: readonly number[]): Amenity[] {
  const have = new Set(ids);
  return (Object.keys(FACILITY_IDS) as Amenity[]).filter((a) => FACILITY_IDS[a].some((id) => have.has(id)));
}

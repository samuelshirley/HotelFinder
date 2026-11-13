import type { ListedPropertyType, PropertyType } from '@/lib/filters';

/**
 * LiteAPI hotel type ids behind each kind of place, from /data/hotelTypes
 * (recorded: __fixtures__/hotel-types.json, 52 entries). Names in comments are
 * the supplier's own; a test checks each against the recording. Only ids seen
 * in the supplier's Porto, Lisbon and Barcelona lists on 2026-11-13 are mapped.
 * Any other id is a kind of place we do not offer as a filter ('other'); 0 and
 * a missing id mean the listing does not say.
 */
export const HOTEL_TYPE_IDS: Record<PropertyType, readonly number[]> = {
  hotel: [204], // Hotels
  aparthotel: [219], // Aparthotels
  apartment: [201], // Apartments
  hostel: [203, 264], // Hostels, Hostel/Backpacker accommodation
  bed_and_breakfast: [208], // Bed and breakfasts
  guest_house: [216, 247], // Guest houses, Pension
  holiday_home: [220, 213], // Holiday homes, Villas
};

/** "Not Available" in the type list. */
const NOT_STATED = 0;

export function propertyTypeFromId(id: number | null | undefined): ListedPropertyType | null {
  if (typeof id !== 'number' || id === NOT_STATED) return null;
  for (const [type, ids] of Object.entries(HOTEL_TYPE_IDS) as Array<[PropertyType, readonly number[]]>) {
    if (ids.includes(id)) return type;
  }
  return 'other';
}

/** The supplier writes "Not Available" for a hotel with no chain on file: that is silence, not "independent". */
export function chainName(chain: string | null | undefined): string | null {
  const name = chain?.trim();
  return name && name.toLowerCase() !== 'not available' ? name : null;
}

/**
 * The must-haves a user can ask for and the app can actually check. Each one
 * is backed by structured supplier data; nothing here is inferred from prose.
 * "Quiet", "safe" and "walkable" are deliberately absent: no supplier field
 * answers them.
 */
export const AMENITIES = [
  'pets_allowed',
  'parking',
  'free_parking',
  'pool',
  'air_conditioning',
  'wifi',
  'lift',
  'wheelchair_accessible',
  'family_rooms',
  'soundproof_rooms',
  'fitness',
  'airport_shuttle',
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Must-haves answered by the offer, not the property. */
export const OFFER_MUST_HAVES = ['free_cancellation', 'breakfast_included'] as const;
export type OfferMustHave = (typeof OFFER_MUST_HAVES)[number];

export const MUST_HAVES = [...AMENITIES, ...OFFER_MUST_HAVES] as const;
export type MustHave = (typeof MUST_HAVES)[number];

/**
 * The amenities a property row lists, from its stored `content.amenities`
 * (server/finder.ts writes it). No array = the supplier sent no facility
 * list: null, unknown, never "none".
 */
export function listedAmenities(content: Record<string, unknown> | null | undefined): Amenity[] | null {
  const raw = content?.amenities;
  if (!Array.isArray(raw)) return null;
  return raw.filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a as string));
}

export function isMustHave(value: string): value is MustHave {
  return (MUST_HAVES as readonly string[]).includes(value);
}

import type { Amenity } from '@/lib/amenities';
import type { SupplierOffer, SupplierProperty } from '@/server/supplier/types';
import type { Candidate } from './rank';

/**
 * One rank candidate per hotel: its cheapest offer. `ids` maps the supplier's
 * ids to ours, so the pure ranking never sees a database.
 */
export function toCandidates(input: {
  offers: Array<{ id: string; offer: SupplierOffer }>;
  properties: Array<{ id: string; property: SupplierProperty }>;
  /** Keyed by supplier hotel id. A hotel absent from the map has unknown amenities. */
  amenities: ReadonlyMap<string, readonly Amenity[]>;
}): Candidate[] {
  const byHotel = new Map(input.properties.map((p) => [p.property.supplierHotelId, p]));
  const cheapest = new Map<string, { id: string; offer: SupplierOffer }>();
  for (const entry of input.offers) {
    const current = cheapest.get(entry.offer.supplierHotelId);
    if (!current || entry.offer.total.amountMinor < current.offer.total.amountMinor) {
      cheapest.set(entry.offer.supplierHotelId, entry);
    }
  }
  const out: Candidate[] = [];
  for (const [hotelId, { id, offer }] of cheapest) {
    const prop = byHotel.get(hotelId);
    if (!prop) continue; // an offer with no property row cannot be shown
    const p = prop.property;
    out.push({
      offerId: id,
      propertyId: prop.id,
      name: p.name,
      totalMinor: offer.total.amountMinor,
      suggestedSellingMinor: offer.suggestedSelling?.amountMinor ?? null,
      location: p.latitude !== null && p.longitude !== null ? { latitude: p.latitude, longitude: p.longitude } : null,
      rating: p.rating,
      reviewCount: p.reviewCount,
      stars: p.stars,
      amenities: input.amenities.get(hotelId) ?? null,
      refundable: offer.cancellation.refundable,
      boardName: offer.rooms[0]?.boardName ?? null,
    });
  }
  return out;
}

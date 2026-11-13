import 'server-only';

import { isMemberOnlyPrice, marginFor, OFFER_TTL_MS } from '@/lib/pricing';
import { occupanciesFor, roomsLabel, roomsOf, sameOccupancies, splitParty, type Occupancy } from '@/lib/finder/rooms';
import { insertOffers, listDetailOffers, type Offer } from '@/server/repos/offers';
import { getProperty } from '@/server/repos/properties';
import { audienceFor, type SearchSession, type Stay } from '@/server/repos/sessions';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * Every room and rate one hotel has for this stay, for its detail view. Stored
 * as offers (so any of them can be booked through the same checkout) marked
 * `detailOnly`, which the ranking never reads. Fetched once per stay and
 * hotel while the rates are live.
 *
 * For the rooms the card shows: the user's rooms when they said, else the
 * split of the hotel's shortlisted offer ("2 rooms: …"), so every rate listed
 * is for the same rooms as the price on the card. One search, not one per split.
 */
export const MAX_RATES = 20;

export type HotelRatesError = 'property_not_found' | 'needs_nationality' | 'supplier_unavailable';

export async function hotelRates(args: {
  session: SearchSession;
  stay: Stay;
  propertyId: string;
  /** The rooms of this hotel's offer on the shortlist, when it has one. */
  shownRooms?: unknown;
  supplier: SupplierAdapter;
  now: Date;
}): Promise<{ ok: true; offers: Offer[]; fetched: boolean } | { ok: false; error: HotelRatesError }> {
  const { session, stay, propertyId, supplier, now } = args;
  const audience = audienceFor(session);
  const occupancies = detailOccupancies(stay, args.shownRooms);
  // Rates held for another split of the party are not these rooms' rates.
  const held = (await listDetailOffers(session.id, stay.id, propertyId, audience, now)).filter((o) => {
    // Rates fetched before the currency was changed are in the old one: fetched again, never converted.
    if (o.currency !== session.currency) return false;
    const rooms = roomsOf(o.rooms);
    return rooms ? sameOccupancies(rooms, occupancies) : stay.rooms !== null;
  });
  if (held.length > 0) return { ok: true, offers: shown(held, audience), fetched: false };

  const property = await getProperty(propertyId);
  if (!property) return { ok: false, error: 'property_not_found' };
  if (!session.guestNationality) return { ok: false, error: 'needs_nationality' };
  const search = await supplier.searchAvailability({
    where: { hotelIds: [property.supplierHotelId] },
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    occupancies,
    currency: session.currency,
    guestNationality: session.guestNationality,
    marginPct: marginFor(audience),
    maxHotels: 1,
    maxRatesPerHotel: MAX_RATES,
  });
  if (!search.ok) return { ok: false, error: 'supplier_unavailable' };
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
  const rows = await insertOffers(
    search.value.offers
      .filter((o) => o.supplierHotelId === property.supplierHotelId)
      .map((o) => ({
        sessionId: session.id,
        stayId: stay.id,
        propertyId,
        supplier: o.supplier,
        supplierOfferId: o.supplierOfferId,
        audience,
        marginPct: o.marginPct.toFixed(2),
        currency: o.total.currency,
        totalMinor: o.total.amountMinor,
        suggestedSellingMinor: o.suggestedSelling?.currency === o.total.currency ? o.suggestedSelling.amountMinor : null,
        payAtPropertyMinor: o.payAtProperty.amountMinor,
        taxesAndFees: o.fees,
        roomName: roomsLabel(o.rooms),
        boardName: o.rooms[0]?.boardName ?? null,
        rooms: o.rooms,
        refundableTag: o.cancellation.tag,
        cancellation: o.cancellation,
        fetchedAt: now,
        expiresAt,
        detailOnly: true,
      })),
  );
  return { ok: true, offers: shown(rows, audience), fetched: true };
}

/** The user's rooms, else the shortlisted offer's split, else the fewest rooms worth pricing. */
export function detailOccupancies(stay: Pick<Stay, 'adults' | 'childrenAges' | 'rooms'>, shownRooms: unknown): Occupancy[] {
  if (stay.rooms !== null) return splitParty(stay.adults, stay.childrenAges, stay.rooms);
  const shown = roomsOf(shownRooms);
  return shown ? shown.map((r) => ({ adults: r.adults, childrenAges: r.childrenAges })) : occupanciesFor(stay)[0];
}

/**
 * Cheapest first, and for an anonymous visitor never a rate under the hotel's
 * public price: the same rule the finder ranks by (lib/pricing.ts). Without it
 * the detail view of any hotel showed the member rates the shortlist hid.
 */
const shown = (rows: Offer[], audience: 'public' | 'member') =>
  rows
    .filter((o) => !isMemberOnlyPrice(o, audience))
    .sort((a, b) => a.totalMinor - b.totalMinor || a.id.localeCompare(b.id));

import 'server-only';

import { roomsLabel } from '@/lib/finder/rooms';
import { publicQuote } from '@/lib/pricing';
import type { Audience } from '@/server/db/schema';
import type { OfferInput } from '@/server/repos/offers';
import type { SupplierOffer } from '@/server/supplier';

/**
 * One supplier offer as the row a session keeps, for the audience that asked.
 * The only place an offer row is built: the finder, a hotel's detail rates and
 * the checkout all write through it, so a `public` row always holds the public
 * price and never the member rate (lib/pricing.ts).
 */
export function offerRow(
  o: SupplierOffer,
  at: { sessionId: string; stayId: string; propertyId: string; audience: Audience; now: Date; expiresAt: Date; detailOnly?: boolean },
): OfferInput {
  const ssp = o.suggestedSelling?.currency === o.total.currency ? o.suggestedSelling.amountMinor : null;
  const quote = at.audience === 'public' ? publicQuote(o) : { totalMinor: o.total.amountMinor, lowerForMembers: false, fees: o.fees, cancellation: o.cancellation };
  return {
    sessionId: at.sessionId,
    stayId: at.stayId,
    propertyId: at.propertyId,
    supplier: o.supplier,
    supplierOfferId: o.supplierOfferId,
    audience: at.audience,
    marginPct: o.marginPct.toFixed(2),
    currency: o.total.currency,
    totalMinor: quote.totalMinor,
    lowerForMembers: quote.lowerForMembers,
    suggestedSellingMinor: ssp,
    payAtPropertyMinor: o.payAtProperty.amountMinor,
    taxesAndFees: quote.fees,
    roomName: roomsLabel(o.rooms),
    boardName: o.rooms[0]?.boardName ?? null,
    rooms: o.rooms,
    refundableTag: o.cancellation.tag,
    cancellation: quote.cancellation,
    fetchedAt: at.now,
    expiresAt: at.expiresAt,
    ...(at.detailOnly ? { detailOnly: true } : {}),
  };
}

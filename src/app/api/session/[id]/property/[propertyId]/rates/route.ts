import { NextResponse } from 'next/server';

import { errorResponse, handled, ownedSession, rateLimit } from '@/server/http';
import { hotelRates } from '@/server/hotelRates';
import { audienceFor, listStays } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { getSupplier } from '@/server/supplier';
import { offerFees, offerPenalties } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every room and rate one shortlisted hotel has for this stay. Each is bookable by its offer id. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string; propertyId: string } }) => {
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('rates', 30);
  if (limited) return limited;
  const stay = (await listStays(session.id))[0];
  const listed = stay ? await listShortlist(session.id, stay.id, audienceFor(session)) : [];
  if (!stay || !listed.some((r) => r.property.id === ctx.params.propertyId)) return errorResponse('property_not_found', 404);

  const r = await hotelRates({ session, stay, propertyId: ctx.params.propertyId, supplier: getSupplier({ sessionId: session.id, userId: session.userId }), now: new Date() });
  if (!r.ok) return errorResponse(r.error === 'property_not_found' ? 'property_not_found' : 'supplier_unavailable', r.error === 'property_not_found' ? 404 : 503);
  return NextResponse.json({
    rates: r.offers.map((o) => ({
      offerId: o.id,
      roomName: o.roomName,
      boardName: o.boardName,
      refundable: o.refundableTag === 'RFN',
      freeCancellationUntil: (o.cancellation as { freeCancellationUntil?: string | null } | null)?.freeCancellationUntil ?? null,
      penalties: offerPenalties(o.cancellation),
      fees: offerFees(o.taxesAndFees),
      currency: o.currency,
      totalMinor: o.totalMinor,
      payAtPropertyMinor: o.payAtPropertyMinor,
    })),
  });
});

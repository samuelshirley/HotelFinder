import { NextResponse } from 'next/server';
import { z } from 'zod';

import { bookingView } from '@/server/checkout';
import { releaseFrozen, type ReleaseError } from '@/server/freeze';
import { errorResponse, handled, ownedBooking, rateLimit, requestLocale } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({}).strict();

const STATUS: Record<ReleaseError, number> = {
  booking_not_found: 404,
  not_cancellable: 409,
  cancel_failed: 502,
  release_unknown: 504,
};

/** Release a frozen booking: cancelled with the hotel, before its free-cancellation deadline. */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  const limited = await rateLimit('release', 10);
  if (limited) return limited;
  const now = new Date();
  const result = await releaseFrozen({ bookingId: owned.id, supplier: getSupplier({ sessionId: owned.sessionId, userId: owned.userId }), by: 'guest', now, locale: requestLocale() });
  if (!result.ok) return errorResponse(result.error, STATUS[result.error]);
  return NextResponse.json({ booking: bookingView(result.booking, now) });
});

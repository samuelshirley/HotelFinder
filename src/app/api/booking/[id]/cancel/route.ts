import { NextResponse } from 'next/server';
import { z } from 'zod';

import { bookingView, cancelBooking } from '@/server/checkout';
import { errorResponse, handled, ownedBooking, rateLimit, requestLocale } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({}).strict();

export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  const limited = await rateLimit('cancel', 10);
  if (limited) return limited;
  const result = await cancelBooking({ bookingId: owned.id, supplier: getSupplier({ sessionId: owned.sessionId, userId: owned.userId }), locale: requestLocale() });
  if (!result.ok) return errorResponse(result.error, result.error === 'cancel_failed' ? 502 : 409);
  return NextResponse.json({ booking: bookingView(result.booking, new Date()) });
});

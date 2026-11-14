import { NextResponse } from 'next/server';
import { z } from 'zod';

import { repriceCheckout } from '@/server/checkout';
import { checkoutInMySearch, currentUser, errorResponse, handled, ownedSession, rateLimit, requestLocale } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({}).strict();

/**
 * After a sign-in in the checkout's modal: the same hotel and room, priced for
 * this account (its nationality, the member rate), as a new prebook. Answers
 * the new booking's id; its page shows both prices when they differ.
 */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const user = await currentUser();
  if (!user) return errorResponse('signed_out', 401);
  const booking = await checkoutInMySearch(ctx.params.id);
  if (booking instanceof NextResponse) return booking;
  const session = await ownedSession(booking.sessionId!);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('checkout', 20);
  if (limited) return limited;
  const result = await repriceCheckout({ session, booking, supplier: getSupplier({ sessionId: session.id, userId: session.userId }), now: new Date(), locale: requestLocale() });
  if (!result.ok) return errorResponse(result.error, result.error === 'supplier_unavailable' ? 503 : result.error === 'property_not_found' ? 404 : 409);
  return NextResponse.json({ bookingId: result.booking.id });
});

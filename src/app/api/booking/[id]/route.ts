import { NextResponse } from 'next/server';

import { mailConfigured } from '@/server/auth/mailer';
import { bookingView } from '@/server/checkout';
import { settleFreeze } from '@/server/freeze';
import { currentUser, handled, ownedBooking } from '@/server/http';
import { paymentMode } from '@/server/payments';
import { lastHolderFor } from '@/server/repos/bookings';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The checkout, or the receipt once paid. A frozen booking whose hold has ended is released first. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string } }) => {
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  const now = new Date();
  const booking = await settleFreeze(owned, getSupplier({ sessionId: owned.sessionId, userId: owned.userId }), now);
  const user = await currentUser();
  return NextResponse.json({
    booking: bookingView(booking, now),
    me: user && { email: user.email },
    lastHolder: user ? await lastHolderFor(user.id) : null,
    payment: paymentMode(),
    /** Whether a freeze reminder can go out by email here; without it the page is the reminder. */
    mail: mailConfigured(),
  });
});

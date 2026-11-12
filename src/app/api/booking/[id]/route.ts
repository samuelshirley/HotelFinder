import { NextResponse } from 'next/server';

import { bookingView } from '@/server/checkout';
import { currentUser, handled, ownedBooking } from '@/server/http';
import { paymentMode } from '@/server/payments';
import { lastHolderFor } from '@/server/repos/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The checkout, or the receipt once paid. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string } }) => {
  const booking = await ownedBooking(ctx.params.id);
  if (booking instanceof NextResponse) return booking;
  const user = await currentUser();
  return NextResponse.json({
    booking: bookingView(booking, new Date()),
    me: user && { email: user.email },
    lastHolder: user ? await lastHolderFor(user.id) : null,
    payment: paymentMode(),
  });
});

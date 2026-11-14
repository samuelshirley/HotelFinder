import { NextResponse } from 'next/server';

import { mailConfigured } from '@/server/auth/mailer';
import { bookingView } from '@/server/checkout';
import { settleFreeze } from '@/server/freeze';
import { checkoutInMySearch, currentUser, errorResponse, handled, noQuery, ownedBooking } from '@/server/http';
import { paymentMode } from '@/server/payments';
import { lastHolderFor } from '@/server/repos/bookings';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The checkout, or the receipt once paid. A frozen booking whose hold has ended is released first. */
export const GET = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const badQuery = noQuery(req);
  if (badQuery) return badQuery;
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) {
    // A checkout in this visitor's search priced for someone else ("Not you?"):
    // nothing of it is shown. Signed out, the page asks for an email; signed
    // in, it prices the same room for this account (POST .../reprice).
    if (!(await checkoutInMySearch(ctx.params.id) instanceof NextResponse)) {
      return (await currentUser()) ? errorResponse('reprice_needed', 409) : errorResponse('signed_out', 401);
    }
    return owned;
  }
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

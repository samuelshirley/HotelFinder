import { NextResponse } from 'next/server';
import { z } from 'zod';

import { bookingView } from '@/server/checkout';
import { keepFrozen, type KeepError } from '@/server/freeze';
import { currentUser, errorResponse, handled, ownedBooking, rateLimit } from '@/server/http';
import { WALLETS } from '@/server/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({ wallet: z.enum(WALLETS), acceptedTotalMinor: z.number().int().nonnegative() }).strict();

const STATUS: Record<KeepError, number> = {
  booking_not_found: 404,
  booking_not_payable: 409,
  freeze_expired: 409,
  price_changed: 409,
  payment_unavailable: 503,
};

/** Confirm a frozen booking: the guest pays the held price. Signed in only: the freeze made the account. */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  const now = new Date();
  const user = await currentUser(now);
  if (!user) return errorResponse('signed_out', 401);
  const limited = await rateLimit('keep', 10);
  if (limited) return limited;
  const result = await keepFrozen({ bookingId: owned.id, userId: user.id, ...parsed.data, now });
  if (!result.ok) return errorResponse(result.error, STATUS[result.error]);
  return NextResponse.json({ booking: bookingView(result.booking, now) });
});

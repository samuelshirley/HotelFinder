import { NextResponse } from 'next/server';
import { z } from 'zod';

import { bookingView } from '@/server/checkout';
import { freezeBooking, type FreezeError } from '@/server/freeze';
import { currentUser, errorResponse, handled, ownedBooking, rateLimit, requestLocale, signInBrowser } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const payload = z
  .object({
    email: z.string().max(300),
    code: z.string().max(12),
    firstName: z.string().max(80),
    lastName: z.string().max(80),
    acceptedTotalMinor: z.number().int().nonnegative(),
  })
  .strict();

const STATUS: Record<FreezeError, number> = {
  booking_not_found: 404,
  booking_not_payable: 409,
  price_changed: 409,
  price_stale: 409,
  freeze_not_eligible: 409,
  name_missing: 400,
  freeze_unavailable: 503,
  email_invalid: 400,
  code_wrong: 400,
  code_expired: 400,
  freeze_limit: 409,
  booking_failed: 502,
  booking_unknown: 504,
  freeze_terms_changed: 409,
};

/** Deal Freeze: checks the code, signs in, and books the free-cancellation rate with no payment. */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  const limited = await rateLimit('freeze', 10);
  if (limited) return limited;

  const now = new Date();
  const user = await currentUser(now);
  const result = await freezeBooking({
    ...parsed.data,
    email: user ? user.email : parsed.data.email,
    bookingId: owned.id,
    signedInUserId: user?.id ?? null,
    supplier: getSupplier({ sessionId: owned.sessionId, userId: user?.id ?? null }),
    now,
    locale: requestLocale(),
  });
  // A verified code signs the browser in even when the freeze then fails: the code is spent.
  if (result.signedInAs) await signInBrowser(result.signedInAs, now);
  if (!result.ok) return errorResponse(result.error, STATUS[result.error]);
  return NextResponse.json({ booking: bookingView(result.booking, now) });
});

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentUser, errorResponse, handled, handOverToBrowser, ownedBooking, rateLimit } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({}).strict();

/**
 * "Not you?" on a checkout: signs this browser out and hands the search, with
 * this checkout's hotel and room, back to the browser. The page then asks for
 * an email in a modal; whoever signs in gets the same room priced for them
 * (POST /api/booking/[id]/reprice).
 */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const user = await currentUser();
  if (!user) return errorResponse('signed_out', 401);
  const owned = await ownedBooking(ctx.params.id);
  if (owned instanceof NextResponse) return owned;
  if (owned.status !== 'prebooked' || !owned.sessionId) return errorResponse('booking_not_payable', 409);
  const limited = await rateLimit('not-you', 10);
  if (limited) return limited;
  await handOverToBrowser(owned.sessionId, user.id);
  return NextResponse.json({ signedIn: false });
});

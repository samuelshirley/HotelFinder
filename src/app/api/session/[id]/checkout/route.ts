import { NextResponse } from 'next/server';
import { z } from 'zod';

import { startCheckout } from '@/server/checkout';
import { errorResponse, handled, ownedSession, rateLimit } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({ offerId: z.string().uuid() }).strict();

/** "Book": the supplier re-checks the rate and the booking row is written before any payment sheet. */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('checkout', 20);
  if (limited) return limited;
  const started = await startCheckout({ session, offerId: parsed.data.offerId, supplier: getSupplier({ sessionId: session.id, userId: session.userId }) });
  if (!started.ok) return errorResponse(started.error, started.error === 'supplier_unavailable' ? 503 : started.error === 'rate_gone' ? 409 : 404);
  return NextResponse.json({ bookingId: started.booking.id });
});

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentOwner, ensureOwner, errorResponse, handled, rateLimit, requestLocale } from '@/server/http';
import { askQuestion } from '@/server/onboarding';
import { listTrips } from '@/server/repos/sessions';
import { startSession } from '@/server/startSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({}).strict();

/** Start a search: a session owned by this browser, with the first question asked. */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('session', 20);
  if (limited) return limited;

  const session = await startSession(await ensureOwner(), headers());
  await askQuestion(session.id, 'destination', {}, requestLocale());
  return NextResponse.json({ sessionId: session.id });
});

/** This visitor's trips, newest first. A visitor with no cookie has none. */
export const GET = handled(async () => {
  const owner = await currentOwner();
  const trips = owner ? await listTrips(owner) : [];
  return NextResponse.json({
    trips: trips.map((t) => ({ id: t.id, status: t.status, destination: t.destination, checkIn: t.checkIn, checkOut: t.checkOut })),
  });
});

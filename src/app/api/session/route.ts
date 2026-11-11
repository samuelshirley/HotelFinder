import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { inferNationality } from '@/lib/nationality';
import { currentOwner, ensureOwner, errorResponse, handled, rateLimit } from '@/server/http';
import { askQuestion } from '@/server/onboarding';
import { getPreferences } from '@/server/repos/preferences';
import { createSession, listTrips, updateSession } from '@/server/repos/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({}).strict();

/** Start a search: a session owned by this browser, with the first question asked. */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('session', 20);
  if (limited) return limited;

  const owner = ensureOwner();
  const session = await createSession(owner);

  // The nationality for rates, inferred and never asked (docs/onboarding.md §4).
  // Nothing here sees a price. The destination is the last resort, filled in
  // when it is answered if none of these gave one.
  const h = headers();
  const saved = 'userId' in owner ? ((await getPreferences(owner.userId))?.guestNationality ?? null) : null;
  const inferred = inferNationality({
    saved,
    acceptLanguage: h.get('accept-language'),
    ipCountry: h.get('x-vercel-ip-country'),
    destinationCountry: null,
  });
  if (inferred) await updateSession(session.id, { guestNationality: inferred.code, nationalitySource: inferred.source });

  await askQuestion(session.id, 'destination');
  return NextResponse.json({ sessionId: session.id });
});

/** This visitor's trips, newest first. A visitor with no cookie has none. */
export const GET = handled(async () => {
  const owner = currentOwner();
  const trips = owner ? await listTrips(owner) : [];
  return NextResponse.json({
    trips: trips.map((t) => ({ id: t.id, status: t.status, destination: t.destination, checkIn: t.checkIn, checkOut: t.checkOut })),
  });
});

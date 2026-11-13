import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentOwner, errorResponse, handled, ownedSession, rateLimit } from '@/server/http';
import { unsaveHotel } from '@/server/repos/saved';
import { saveFromSearch, savedView } from '@/server/saved';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The heart. Saving names the search the hotel is on (only a hotel on the
 * visitor's own list can be saved); unsaving needs only the hotel. Either way
 * the answer is the whole saved list, so the client never guesses it.
 */
const payload = z.discriminatedUnion('saved', [
  z.object({ saved: z.literal(true), propertyId: z.string().uuid(), sessionId: z.string().uuid() }).strict(),
  z.object({ saved: z.literal(false), propertyId: z.string().uuid() }).strict(),
]);

export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('saved', 60);
  if (limited) return limited;

  if (parsed.data.saved) {
    const session = await ownedSession(parsed.data.sessionId);
    if (session instanceof NextResponse) return session;
    const saved = await saveFromSearch(session, parsed.data.propertyId);
    if (!saved.ok) return errorResponse(saved.error, 404);
  } else {
    const owner = await currentOwner();
    if (owner) await unsaveHotel(owner, parsed.data.propertyId);
  }
  const owner = await currentOwner();
  return NextResponse.json({ saved: owner ? await savedView(owner) : [] });
});

/** This visitor's saved hotels, newest first. A visitor with no cookie has none. */
export const GET = handled(async () => {
  const owner = await currentOwner();
  return NextResponse.json({ saved: owner ? await savedView(owner) : [] });
});

import { NextResponse } from 'next/server';

import { errorResponse, handled, noQuery, ownedSession, rateLimit, requestLocale } from '@/server/http';
import { readPropertyDetails } from '@/server/propertyDetails';
import { audienceFor, listStays } from '@/server/repos/sessions';
import { isListed } from '@/server/repos/shortlist';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Photos, description and facilities for one shortlisted hotel. Supplier text is data and is sent as plain text. */
export const GET = handled(async (req: Request, ctx: { params: { id: string; propertyId: string } }) => {
  const badQuery = noQuery(req);
  if (badQuery) return badQuery;
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('property', 60);
  if (limited) return limited;

  // Only a hotel this session lists (the shortlist or the full list) can be opened.
  const stay = (await listStays(session.id))[0];
  if (!stay || !(await isListed(session.id, stay.id, ctx.params.propertyId, audienceFor(session)))) return errorResponse('property_not_found', 404);
  const details = await readPropertyDetails(getSupplier({ sessionId: session.id, userId: session.userId, language: requestLocale() }), ctx.params.propertyId);
  if (!details.ok) return errorResponse(details.error, details.error === 'property_not_found' ? 404 : 503);
  return NextResponse.json(details.value);
});

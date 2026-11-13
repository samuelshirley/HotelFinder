import { NextResponse } from 'next/server';

import { errorResponse, handled, ownedSession, rateLimit, requestLocale } from '@/server/http';
import { readPropertyDetails } from '@/server/propertyDetails';
import { audienceFor, listStays } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Photos, description and facilities for one shortlisted hotel. Supplier text is data and is sent as plain text. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string; propertyId: string } }) => {
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('property', 60);
  if (limited) return limited;

  // Only a hotel on this session's shortlist can be opened.
  const stay = (await listStays(session.id))[0];
  const listed = stay ? await listShortlist(session.id, stay.id, audienceFor(session)) : [];
  if (!listed.some((r) => r.property.id === ctx.params.propertyId)) return errorResponse('property_not_found', 404);
  const details = await readPropertyDetails(getSupplier({ sessionId: session.id, userId: session.userId, language: requestLocale() }), ctx.params.propertyId);
  if (!details.ok) return errorResponse(details.error, details.error === 'property_not_found' ? 404 : 503);
  return NextResponse.json(details.value);
});

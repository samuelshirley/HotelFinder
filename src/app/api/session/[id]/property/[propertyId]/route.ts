import { NextResponse } from 'next/server';

import { errorResponse, handled, ownedSession, rateLimit } from '@/server/http';
import { getProperty } from '@/server/repos/properties';
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
  const property = await getProperty(ctx.params.propertyId);
  if (!property) return errorResponse('property_not_found', 404);

  const details = await getSupplier({ sessionId: session.id, userId: session.userId }).getStaticContent(property.supplierHotelId);
  if (!details.ok) return errorResponse('supplier_unavailable', 503);
  const plain = (html: string | null) => (html ? html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null);
  return NextResponse.json({
    id: property.id,
    name: details.value.name,
    address: details.value.address,
    stars: details.value.stars,
    rating: details.value.rating,
    reviewCount: details.value.reviewCount,
    description: plain(details.value.description),
    importantInformation: plain(details.value.importantInformation),
    facilities: details.value.facilities.slice(0, 40),
    imageUrls: details.value.imageUrls.slice(0, 12),
    petsAllowed: details.value.petsAllowed,
    parking: details.value.parking,
  });
});

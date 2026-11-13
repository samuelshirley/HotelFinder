import { NextResponse } from 'next/server';
import { z } from 'zod';

import { viewerNationality } from '@/server/checkout';
import { runFinder } from '@/server/finder';
import { errorResponse, handled, ownedSession, rateLimit, requestLocale } from '@/server/http';
import { listStays } from '@/server/repos/sessions';
import { getSupplier } from '@/server/supplier';
import { buildSessionView } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({}).strict();

/**
 * "Re-price for whoever is looking now", for the results: after a sign-in
 * (member prices) or "Not you?" (public prices), when the search's latest
 * prices were fetched for someone else (`repriceNeeded` in the view). The
 * account's saved nationality is applied first. Answers the new view.
 */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('edit', 60);
  if (limited) return limited;
  const stay = (await listStays(session.id))[0];
  if (!stay || session.status === 'onboarding') return errorResponse('not_active', 409);
  const locale = requestLocale();
  const supplier = getSupplier({ sessionId: session.id, userId: session.userId, language: locale });
  const now = new Date();
  const viewer = await viewerNationality(session, supplier, now);
  // A changed nationality has already fetched the search again (dispatch).
  const outcome = viewer.changed ? null : await runFinder({ sessionId: session.id, stayId: stay.id, supplier, now });
  if (outcome?.kind === 'supplier_error') return errorResponse('supplier_unavailable', 503);
  return NextResponse.json(await buildSessionView(viewer.session, locale, now));
});

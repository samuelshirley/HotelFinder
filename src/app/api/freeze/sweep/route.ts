import { NextResponse } from 'next/server';

import { sweepAllowed, sweepFreezes } from '@/server/freeze';
import { errorResponse, handled, noQuery } from '@/server/http';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The Deal Freeze sweep (docs/deal-freeze.md): releases ended holds, reads
 * back unanswered releases, sends due reminders. For a scheduler (Vercel Cron
 * sends GET with the CRON_SECRET bearer). No payload.
 */
export const GET = handled(async (req: Request) => {
  // Not found to anyone without the secret, whatever the query says.
  if (!sweepAllowed(req.headers.get('authorization'))) return errorResponse('not_allowed', 404);
  const badQuery = noQuery(req);
  if (badQuery) return badQuery;
  const report = await sweepFreezes({ now: new Date(), supplierFor: (b) => getSupplier({ sessionId: b.sessionId, userId: b.userId }) });
  return NextResponse.json(report);
});

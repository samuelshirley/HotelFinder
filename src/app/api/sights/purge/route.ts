import { NextResponse } from 'next/server';

import { expiredSightsLine } from '@/lib/sights';
import { sweepAllowed } from '@/server/freeze';
import { errorResponse, handled, noQuery } from '@/server/http';
import { purgeExpiredSights } from '@/server/repos/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google's 30 days (docs/sights.md): removes every stay's sights fetched more
 * than 30 days ago, and the chat lines that named them. For a scheduler
 * (Vercel Cron, daily, vercel.json, with the CRON_SECRET bearer). Every new
 * search runs the same purge. No payload.
 */
export const GET = handled(async (req: Request) => {
  // Not found to anyone without the secret, whatever the query says.
  if (!sweepAllowed(req.headers.get('authorization'))) return errorResponse('not_allowed', 404);
  const badQuery = noQuery(req);
  if (badQuery) return badQuery;
  return NextResponse.json(await purgeExpiredSights(new Date(), expiredSightsLine));
});

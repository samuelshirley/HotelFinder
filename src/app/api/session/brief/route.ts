import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { agentModel } from '@/lib/models';
import { callAnthropic } from '@/server/agent';
import { briefSchema, checkBrief, startFromBrief } from '@/server/brief';
import { ensureOwner, errorResponse, handled, rateLimit, requestLocale, resolveToday } from '@/server/http';
import { startSession } from '@/server/startSession';
import { getSupplier } from '@/server/supplier';
import { isoDate } from '@/lib/isoDate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({ brief: briefSchema, today: isoDate }).strict();

/** The first screen's one submit: a new search from the trip box and its pills. */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('session', 20);
  if (limited) return limited;
  const now = new Date();
  const today = resolveToday(parsed.data.today, now);
  if (!today) return errorResponse('bad_date', 400);

  // Checked before a session exists, so a refused brief leaves nothing behind.
  const bad = checkBrief(parsed.data.brief, today);
  if (bad) return errorResponse(bad, 400);

  const session = await startSession(await ensureOwner(), headers());
  const locale = requestLocale();
  const result = await startFromBrief({
    session,
    brief: parsed.data.brief,
    supplier: getSupplier({ sessionId: session.id, userId: session.userId, language: locale }),
    callModel: callAnthropic,
    model: agentModel(),
    now,
    today,
    locale,
  });
  if (!result.ok) return errorResponse(result.error, 400);
  return NextResponse.json({ sessionId: session.id });
});

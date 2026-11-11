import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureOwner, errorResponse, handled, rateLimit } from '@/server/http';
import { askQuestion } from '@/server/onboarding';
import { createSession } from '@/server/repos/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({}).strict();

/** Start a search: a session owned by this browser, with the first question asked. */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('session', 20);
  if (limited) return limited;

  const session = await createSession(ensureOwner());
  await askQuestion(session.id, 'destination');
  return NextResponse.json({ sessionId: session.id });
});

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errorResponse, handled, ownedSession, rateLimit } from '@/server/http';
import { logUsage } from '@/server/repos/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Product events for the detail A/B test: which variant, opened, then Book pressed. No personal data. */
const payload = z.object({ name: z.enum(['detail_open', 'detail_book']), variant: z.enum(['expand', 'slideout']), sessionId: z.string().uuid() }).strict();

export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const limited = await rateLimit('events', 120);
  if (limited) return limited;
  const session = await ownedSession(parsed.data.sessionId);
  if (session instanceof NextResponse) return session;
  await logUsage({ provider: 'app', sessionId: session.id, userId: session.userId, success: true, latencyMs: 0, meta: { event: parsed.data.name, variant: parsed.data.variant } });
  return NextResponse.json({ ok: true });
});

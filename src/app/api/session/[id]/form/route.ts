import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errorResponse, handled, ownedSession, rateLimit, requestLocale, resolveToday } from '@/server/http';
import { answerForm, formAnswerSchema, guestsAnsweredIn } from '@/server/onboarding';
import { listMessages } from '@/server/repos/chat';
import { getSession } from '@/server/repos/sessions';
import { getSupplier } from '@/server/supplier';
import { buildSessionView } from '@/server/view';
import { isoDate } from '@/lib/isoDate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const payload = z.object({ answer: formAnswerSchema, today: isoDate }).strict();

/** One answer to the onboarding question currently being asked. */
export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('form', 60);
  if (limited) return limited;

  const now = new Date();
  const today = resolveToday(parsed.data.today, now);
  if (!today) return errorResponse('bad_date', 400);

  const locale = requestLocale();
  const guestsAnswered = guestsAnsweredIn(session, await listMessages(session.id));
  const result = await answerForm({
    sessionId: session.id,
    answer: parsed.data.answer,
    guestsAnswered,
    supplier: getSupplier({ sessionId: session.id, userId: session.userId, language: locale }),
    now,
    today,
    locale,
  });
  if (!result.ok) return errorResponse(result.error, result.error === 'wrong_step' ? 409 : 400);
  return NextResponse.json(await buildSessionView((await getSession(session.id))!, locale));
});

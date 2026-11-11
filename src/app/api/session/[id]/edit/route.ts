import { NextResponse } from 'next/server';
import { z } from 'zod';

import { actionSchema } from '@/lib/store/actions';
import { dispatchActions } from '@/server/dispatch';
import { errorResponse, handled, ownedSession, rateLimit, resolveToday } from '@/server/http';
import { getSession, listStays } from '@/server/repos/sessions';
import { getSupplier } from '@/server/supplier';
import { buildSessionView } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The results header's chips, edited in place: the nationality used for
 * rates, what "best" means, and where "close" is measured from. Typed actions
 * through the one dispatch path; no model. Only these four action types: the
 * rest of a search is changed in the chat.
 */
const EDITABLE = ['set_nationality', 'set_priorities', 'set_near', 'clear_near'] as const;
const editAction = actionSchema.refine((a) => (EDITABLE as readonly string[]).includes(a.type), 'not editable here');
const payload = z.object({ action: editAction, today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const body = await req.json().catch(() => null);
  const parsed = payload.safeParse(body);
  if (!parsed.success) {
    const code = (body as { action?: { type?: string } } | null)?.action?.type === 'set_nationality' ? 'unknown_country' : 'invalid_request';
    return errorResponse(code, 400);
  }
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('edit', 60);
  if (limited) return limited;
  const stay = (await listStays(session.id))[0];
  if (!stay || session.status === 'onboarding') return errorResponse('not_active', 409);

  const now = new Date();
  const today = resolveToday(parsed.data.today, now);
  if (!today) return errorResponse('bad_date', 400);

  const dispatched = await dispatchActions({
    session,
    stay,
    actions: [parsed.data.action],
    supplier: getSupplier({ sessionId: session.id, userId: session.userId }),
    now,
    today,
  });
  for (const r of dispatched.results) {
    if (r.ok) continue;
    if (r.rejection === 'place_unavailable') return errorResponse('place_unavailable', 503);
    if (r.rejection === 'near_too_far') return errorResponse('near_too_far', 400);
    // no_change is not an error: the chip already says that.
  }
  return NextResponse.json(await buildSessionView((await getSession(session.id))!));
});

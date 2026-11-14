import { NextResponse } from 'next/server';
import { z } from 'zod';

import { describeChange } from '@/lib/replies';
import { actionSchema } from '@/lib/store/actions';
import { dispatchActions } from '@/server/dispatch';
import { upsertChipLine } from '@/server/repos/chat';
import { errorResponse, handled, ownedSession, rateLimit, resolveToday, requestLocale } from '@/server/http';
import { getSession, listStays } from '@/server/repos/sessions';
import { getSupplier } from '@/server/supplier';
import { buildSessionView } from '@/server/view';
import { isoDate } from '@/lib/isoDate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The results header's chips, edited in place: where, when, who (and the
 * pet), what "best" means, where "close" is measured from, the
 * nationality used for rates, and the filters (stars, rating, kind, brand). Typed actions through the one dispatch path; no
 * model. The rest of a search is changed in the chat. The currency picker
 * too: a new currency is a new search, priced by the supplier.
 */
const EDITABLE = ['set_destination', 'set_dates', 'set_guests', 'add_must_have', 'remove_must_have', 'set_nationality', 'set_currency', 'set_priorities', 'set_near', 'set_near_point', 'clear_near', 'set_min_stars', 'set_min_rating', 'set_property_types', 'set_chains'] as const;
const editAction = actionSchema.refine((a) => (EDITABLE as readonly string[]).includes(a.type), 'not editable here');
/** One chip's change: at most a few actions (Who = the party plus the pet). */
const payload = z.object({ actions: z.array(editAction).min(1).max(3), today: isoDate }).strict();

export const POST = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const body = await req.json().catch(() => null);
  const parsed = payload.safeParse(body);
  if (!parsed.success) {
    const types = (body as { actions?: Array<{ type?: string }> } | null)?.actions?.map((a) => a?.type) ?? [];
    const code = types.includes('set_nationality') ? 'unknown_country' : types.includes('set_currency') ? 'unknown_currency' : 'invalid_request';
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
  const locale = requestLocale();

  const dispatched = await dispatchActions({
    session,
    stay,
    actions: parsed.data.actions,
    supplier: getSupplier({ sessionId: session.id, userId: session.userId, language: locale }),
    now,
    today,
  });
  for (const r of dispatched.results) {
    if (r.ok) continue;
    if (r.rejection === 'place_unavailable') return errorResponse('place_unavailable', 503);
    if (r.rejection === 'near_too_far') return errorResponse('near_too_far', 400);
    if (r.rejection === 'dates_in_past' || r.rejection === 'checkout_not_after_checkin' || r.rejection === 'stay_too_long' || r.rejection === 'more_rooms_than_adults') return errorResponse(r.rejection, 400);
    // no_change is not an error: the chip already says that.
  }
  // The change and what it did go in the chat, like a typed change (the
  // results panel points there when nothing fits) — but as ONE line that a run
  // of chip edits keeps rewriting, not a new message per filter.
  if (dispatched.results.some((r) => r.ok)) {
    const content = describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder, locale);
    if (content) await upsertChipLine(session.id, content);
  }
  return NextResponse.json(await buildSessionView((await getSession(session.id))!, locale));
});

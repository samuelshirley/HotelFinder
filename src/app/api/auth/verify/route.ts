import { NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeEmail, verifyCode } from '@/server/auth/otp';
import { userForVerifiedEmail } from '@/server/auth/user';
import { dispatchActions } from '@/server/dispatch';
import { appendMessage } from '@/server/repos/chat';
import { getSession, listStays } from '@/server/repos/sessions';
import { copy } from '@/lib/i18n';
import { errorResponse, handled, rateLimit, requestLocale, resolveToday, signInBrowser } from '@/server/http';
import { getSupplier } from '@/server/supplier';
import { buildSessionView } from '@/server/view';
import { isoDate } from '@/lib/isoDate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z
  .object({
    email: z.string().max(300),
    code: z.string().max(12),
    /** Signed in from a search ("Sign in for member prices", a card's "Sign in for a lower price"): that search is re-run at member prices. */
    sessionId: z.string().uuid().optional(),
    today: isoDate.optional(),
  })
  .strict();

/**
 * Signs this browser in with a code from /api/auth/code: the admin page and
 * the sign-in modal (results and checkout). Same codes, same attempt limits,
 * same cookie as the checkout's confirm.
 * With a session id, that search (now the account's) is ranked again at
 * member prices through the one dispatch path, and its view is returned.
 */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const email = normalizeEmail(parsed.data.email);
  if (!email) return errorResponse('email_invalid', 400);
  const limited = await rateLimit('auth-verify', 10);
  if (limited) return limited;
  const now = new Date();
  const verified = await verifyCode(email, parsed.data.code.trim(), now);
  if (!verified.ok) return errorResponse(verified.error, 400);
  const user = await userForVerifiedEmail(email, now);
  await signInBrowser(user.id, now);
  if (!parsed.data.sessionId) return NextResponse.json({ signedIn: true });

  // signInBrowser adopted this browser's anonymous searches; any other id is not ours to touch.
  const session = await getSession(parsed.data.sessionId);
  if (!session || session.userId !== user.id) return NextResponse.json({ signedIn: true });
  const stay = (await listStays(session.id))[0];
  const today = parsed.data.today ? resolveToday(parsed.data.today, now) : null;
  if (stay && today && session.status !== 'onboarding') {
    // Member offers are held apart from public ones, so the finder fetches them (lib/pricing.ts).
    // One more try when the supplier does not answer (it is free); the line says only what happened:
    // CI, 2026-11-14, "member prices now" was said over the public rows of a search that had failed.
    const rank = () => dispatchActions({ session, stay, actions: [], supplier: getSupplier({ sessionId: session.id, userId: user.id }), now, today, alwaysRun: true });
    let ranked = await rank();
    if (ranked.finder?.kind !== 'ok') ranked = await rank();
    const replies = copy(requestLocale()).replies;
    const line = ranked.finder?.kind === 'ok' ? replies.signedInMemberPrices : replies.signedInPricesLater;
    await appendMessage({ sessionId: session.id, role: 'assistant', kind: 'line', content: line });
  }
  return NextResponse.json({ signedIn: true, view: await buildSessionView((await getSession(session.id))!) });
});

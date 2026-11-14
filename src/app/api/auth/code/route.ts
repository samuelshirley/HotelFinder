import { NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeEmail, sendCode } from '@/server/auth/otp';
import { errorResponse, handled, rateLimit, requestLocale } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({ email: z.string().max(300) }).strict();

/**
 * Sends a six-digit sign-in code. With no email service configured (not in
 * production), the code comes back in the answer and the page shows it.
 */
export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const email = normalizeEmail(parsed.data.email);
  if (!email) return errorResponse('email_invalid', 400);
  const limited = await rateLimit('auth-code', 10);
  if (limited) return limited;
  const sent = await sendCode(email, new Date(), requestLocale());
  if (!sent.ok) return errorResponse(sent.error, sent.error === 'too_many_codes' ? 429 : 503);
  return NextResponse.json(sent.delivery.via === 'dev_mailbox' ? { sent: true, devCode: sent.delivery.code } : { sent: true });
});

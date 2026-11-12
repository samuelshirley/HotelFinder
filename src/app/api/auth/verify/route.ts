import { NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeEmail, verifyCode } from '@/server/auth/otp';
import { userForVerifiedEmail } from '@/server/auth/user';
import { errorResponse, handled, rateLimit, signInBrowser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payload = z.object({ email: z.string().max(300), code: z.string().max(12) }).strict();

/**
 * Signs this browser in with a code from /api/auth/code, outside checkout
 * (the admin page). Same codes, same attempt limits, same cookie as checkout.
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
  return NextResponse.json({ signedIn: true });
});

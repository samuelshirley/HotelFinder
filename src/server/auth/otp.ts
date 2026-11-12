import 'server-only';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { authSecret } from '@/server/auth/anon';
import { deliverCode, type Delivery } from '@/server/auth/mailer';
import { db } from '@/server/db/client';
import { emailOtpCodes } from '@/server/db/schema';

/**
 * Six-digit email codes: no passwords. A code is single-use, lives ten
 * minutes, allows five wrong tries, and only its HMAC is stored. At most five
 * codes an hour per email address.
 */
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

const codeHash = (email: string, code: string) => createHmac('sha256', authSecret()).update(`otp:${email}:${code}`).digest('hex');

export type SendResult = { ok: true; delivery: Delivery } | { ok: false; error: 'too_many_codes' | 'email_unavailable' };

export async function sendCode(email: string, now: Date): Promise<SendResult> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), gt(emailOtpCodes.createdAt, hourAgo)));
  if (n >= MAX_CODES_PER_HOUR) return { ok: false, error: 'too_many_codes' };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(emailOtpCodes).values({ email, codeHash: codeHash(email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now });
  const delivery = await deliverCode(email, code);
  return delivery ? { ok: true, delivery } : { ok: false, error: 'email_unavailable' };
}

export type VerifyResult = { ok: true } | { ok: false; error: 'code_wrong' | 'code_expired' };

/**
 * Checks the newest live code for this email. A wrong guess counts against it;
 * the right one is consumed by a conditional update, so two presses of the
 * same code cannot both sign in.
 */
export async function verifyCode(email: string, code: string, now: Date): Promise<VerifyResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code_wrong' };
  const [row] = await db
    .select()
    .from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt), gt(emailOtpCodes.expiresAt, now)))
    .orderBy(desc(emailOtpCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'code_expired' };

  const given = Buffer.from(codeHash(email, code));
  const stored = Buffer.from(row.codeHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    await db.update(emailOtpCodes).set({ attempts: sql`${emailOtpCodes.attempts} + 1` }).where(eq(emailOtpCodes.id, row.id));
    return { ok: false, error: row.attempts + 1 >= MAX_ATTEMPTS ? 'code_expired' : 'code_wrong' };
  }
  const used = await db
    .update(emailOtpCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailOtpCodes.id, row.id), isNull(emailOtpCodes.consumedAt)))
    .returning({ id: emailOtpCodes.id });
  return used.length === 1 ? { ok: true } : { ok: false, error: 'code_expired' };
}

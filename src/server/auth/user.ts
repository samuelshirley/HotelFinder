import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { sessions, users } from '@/server/db/schema';

/**
 * A signed-in visitor: a random token in an httpOnly cookie, kept server-side
 * only as its SHA-256 (a database read does not hand out working cookies).
 * Revoked by deleting the row.
 */
export const USER_COOKIE = 'hf_user';
export const USER_SESSION_DAYS = 30;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type SignedInUser = { id: string; email: string; name: string | null };

export async function createUserSession(userId: string, now: Date): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + USER_SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ sessionToken: hash(token), userId, expires });
  return { token, expires };
}

export async function userForToken(token: string | undefined, now: Date): Promise<SignedInUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.sessionToken, hash(token)), gt(sessions.expires, now)));
  return row ?? null;
}

export async function endUserSession(token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.sessionToken, hash(token)));
}

/** The account for a verified email, created on first sign-in. */
export async function userForVerifiedEmail(email: string, now: Date): Promise<SignedInUser> {
  const [row] = await db
    .insert(users)
    .values({ email, emailVerified: now })
    .onConflictDoUpdate({ target: users.email, set: { emailVerified: now } })
    .returning({ id: users.id, email: users.email, name: users.name });
  return row;
}

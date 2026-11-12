import { BASE_PATH } from '@/lib/basePath';
import 'server-only';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import type { ErrorCode } from '@/lib/errors';
import { ANON_COOKIE, mintAnonCookie, readAnonCookie } from '@/server/auth/anon';
import { createUserSession, endUserSession, USER_COOKIE, userForToken, type SignedInUser } from '@/server/auth/user';
import { getBooking, type Booking } from '@/server/repos/bookings';
import { countRequest } from '@/server/repos/rateLimit';
import { adoptAnonymousSessions, assertSessionOwned, SessionNotOwnedError, type Owner, type SearchSession } from '@/server/repos/sessions';

/** Shared by every route: who is asking, error responses, the per-IP limit. */

export function errorResponse(code: ErrorCode, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

/** The signed-in user, or null. Checked against the database on every request, so a sign-out ends it. */
export async function currentUser(now = new Date()): Promise<SignedInUser | null> {
  return userForToken(cookies().get(USER_COOKIE)?.value, now);
}

/** The visitor's signed anonymous id, or null if they have none. */
export function currentAnonId(): string | null {
  return readAnonCookie(cookies().get(ANON_COOKIE)?.value);
}

/** Who is asking: the signed-in account, else the anonymous cookie, else nobody. */
export async function currentOwner(): Promise<Owner | null> {
  const user = await currentUser();
  if (user) return { userId: user.id };
  const anonId = currentAnonId();
  return anonId ? { anonId } : null;
}

/** The visitor, minting and setting the anonymous cookie when they have neither. */
export async function ensureOwner(): Promise<Owner> {
  const existing = await currentOwner();
  if (existing) return existing;
  const { anonId, value } = mintAnonCookie();
  cookies().set(ANON_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: BASE_PATH,
    maxAge: 60 * 60 * 24 * 30,
  });
  return { anonId };
}

/** Signs the browser in as `userId` and hands it this browser's anonymous searches. */
export async function signInBrowser(userId: string, now: Date): Promise<void> {
  const { token, expires } = await createUserSession(userId, now);
  cookies().set(USER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: BASE_PATH, expires });
  const anonId = currentAnonId();
  if (anonId) await adoptAnonymousSessions(anonId, userId);
}

export async function signOutBrowser(): Promise<void> {
  await endUserSession(cookies().get(USER_COOKIE)?.value);
  cookies().delete({ name: USER_COOKIE, path: BASE_PATH });
}

/** The session if this visitor owns it; otherwise a 404 that does not say whether it exists. */
export async function ownedSession(id: string): Promise<SearchSession | NextResponse> {
  const owner = await currentOwner();
  if (!owner || !/^[0-9a-f-]{36}$/i.test(id)) return errorResponse('session_not_found', 404);
  try {
    return await assertSessionOwned(id, owner);
  } catch (err) {
    if (err instanceof SessionNotOwnedError) return errorResponse('session_not_found', 404);
    throw err;
  }
}

export function clientIp(): string {
  const forwarded = headers().get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || headers().get('x-real-ip') || 'local';
}

/** Returns a 429 response when this IP is over `max` requests a minute on `route`. */
export async function rateLimit(route: string, max: number): Promise<NextResponse | null> {
  const { allowed } = await countRequest(`${route}:${clientIp()}`, new Date(), 60_000, max);
  return allowed ? null : errorResponse('rate_limited', 429);
}

/**
 * The user's calendar date. The client sends its own; it is accepted only
 * within a day of the server's UTC date, so a wrong clock cannot book the past.
 */
export function resolveToday(clientToday: string, now: Date): string | null {
  const utc = now.toISOString().slice(0, 10);
  const days = Math.abs(Date.parse(`${clientToday}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`)) / 86_400_000;
  return days <= 1 ? clientToday : null;
}

/** Wrap a route so an unexpected throw is logged and answered, never swallowed. */
export function handled<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error('[api] unhandled', err);
      return errorResponse('server_error', 500);
    }
  };
}

/**
 * The booking if this visitor may see it: the account that paid for it, or
 * whoever owns the search it came from (before sign-in, the anonymous cookie).
 * Otherwise a 404 that does not say whether it exists.
 */
export async function ownedBooking(id: string): Promise<Booking | NextResponse> {
  const booking = await getBooking(id);
  if (!booking) return errorResponse('booking_not_found', 404);
  const user = await currentUser();
  if (booking.userId && user?.id === booking.userId) return booking;
  if (!booking.userId && booking.sessionId) {
    const session = await ownedSession(booking.sessionId);
    if (!(session instanceof NextResponse)) return booking;
  }
  return errorResponse('booking_not_found', 404);
}

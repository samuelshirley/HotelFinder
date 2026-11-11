import 'server-only';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import type { ErrorCode } from '@/lib/errors';
import { ANON_COOKIE, mintAnonCookie, readAnonCookie } from '@/server/auth/anon';
import { countRequest } from '@/server/repos/rateLimit';
import { assertSessionOwned, SessionNotOwnedError, type Owner, type SearchSession } from '@/server/repos/sessions';

/** Shared by every route: who is asking, error responses, the per-IP limit. */

export function errorResponse(code: ErrorCode, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

/** The visitor's signed anonymous id, or null if they have none. */
export function currentOwner(): Owner | null {
  const anonId = readAnonCookie(cookies().get(ANON_COOKIE)?.value);
  return anonId ? { anonId } : null;
}

/** The visitor's anonymous id, minting and setting the cookie when they have none. */
export function ensureOwner(): Owner {
  const existing = currentOwner();
  if (existing) return existing;
  const { anonId, value } = mintAnonCookie();
  cookies().set(ANON_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return { anonId };
}

/** The session if this visitor owns it; otherwise a 404 that does not say whether it exists. */
export async function ownedSession(id: string): Promise<SearchSession | NextResponse> {
  const owner = currentOwner();
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

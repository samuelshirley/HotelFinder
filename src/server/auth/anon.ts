import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The anonymous visitor's id: a random value plus an HMAC, in an httpOnly
 * cookie. A visitor cannot mint or guess another visitor's id, so an
 * anonymous session opens only for the browser that started it.
 */
export const ANON_COOKIE = 'hf_anon';

let devSecret: string | null = null;

function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set');
  // Local development: a secret generated once and kept beside the dev database.
  if (!devSecret) {
    const dir = path.resolve(process.env.HOTEL_FINDER_DATA_DIR ?? path.join(process.cwd(), '.data'));
    const file = path.join(dir, 'dev-secret');
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    devSecret = readFileSync(file, 'utf8').trim();
  }
  return devSecret;
}

const sign = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url');

export function mintAnonCookie(): { anonId: string; value: string } {
  const anonId = randomBytes(18).toString('base64url');
  return { anonId, value: `${anonId}.${sign(anonId)}` };
}

/** The anon id inside a cookie value, or null when it is missing, malformed or not signed by us. */
export function readAnonCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

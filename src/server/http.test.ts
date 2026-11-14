import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }), headers: () => new Headers() }));
vi.mock('@/server/db/client', () => ({ db: {}, schema: {} }));

import { handled, noQuery, resolveToday } from './http';

describe('the user\'s date', () => {
  const now = new Date('2026-11-11T23:30:00Z');
  it('accepts the client date within a day of the server\'s, either side of midnight', () => {
    expect(resolveToday('2026-11-11', now)).toBe('2026-11-11');
    expect(resolveToday('2026-11-12', now)).toBe('2026-11-12'); // already tomorrow in Madrid
    expect(resolveToday('2026-11-10', now)).toBe('2026-11-10'); // still yesterday in Honolulu
  });
  it('refuses a clock that is days off', () => {
    expect(resolveToday('2026-11-08', now)).toBeNull();
    expect(resolveToday('2030-01-01', now)).toBeNull();
    expect(resolveToday('not-a-date', now)).toBeNull();
  });
});

/** What a 500 tells the user and the log (2026-11-13: it told neither anything). */
describe('handled', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a throw answers 500 with a ref, and the log line carries that ref, the public route and the drift hint', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drift = Object.assign(new Error('column "anon_id" of relation "usage_events" does not exist'), { name: 'PostgresError', code: '42703' });
    const route = handled(async (_req: Request) => {
      throw drift;
    });
    const res = await route(new Request('http://localhost/api/session/brief', { method: 'POST', headers: { 'x-vercel-id': 'cdg1::iad1::abc' } }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; ref: string };
    expect(body.error).toBe('server_error');
    expect(body.ref).toMatch(/^[0-9a-f]{8}$/);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain(`ref=${body.ref}`);
    expect(line).toContain('POST /hotels/api/session/brief');
    expect(line).toContain('vercel=cdg1::iad1::abc');
    expect(line).toContain('SCHEMA DRIFT pg=42703');
    expect(log.mock.calls[0][1]).toBe(drift); // the stack, too
  });

  it('two failures get two refs; a route that answers is untouched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = handled(async () => {
      throw new Error('x');
    });
    const refs = await Promise.all([boom(), boom()].map(async (p) => ((await (await p).json()) as { ref: string }).ref));
    expect(new Set(refs).size).toBe(2);
    const fine = await handled(async () => new Response('ok'))();
    expect(await fine.text()).toBe('ok');
  });
});

/** Every GET is strict about its query (Sam, 2026-11-14). */
describe('noQuery', () => {
  it('passes a GET with no query, and refuses any parameter with 400 invalid_request', async () => {
    expect(noQuery(new Request('http://x/hotels/api/me'))).toBeNull();
    expect(noQuery(new Request('http://x/hotels/api/me?'))).toBeNull();
    for (const q of ['?a=1', '?a', '?a=', '?=1']) {
      const res = noQuery(new Request(`http://x/hotels/api/me${q}`));
      expect(res?.status, q).toBe(400);
      expect(await res!.json()).toEqual({ error: 'invalid_request' });
    }
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }), headers: () => new Headers() }));
vi.mock('@/server/db/client', () => ({ db: {}, schema: {} }));

import { resolveToday } from './http';

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

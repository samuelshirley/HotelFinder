import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('the anonymous cookie', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'secret-one');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips an id it signed', async () => {
    const { mintAnonCookie, readAnonCookie } = await import('./anon');
    const { anonId, value } = mintAnonCookie();
    expect(anonId.length).toBeGreaterThanOrEqual(20);
    expect(readAnonCookie(value)).toBe(anonId);
    expect(mintAnonCookie().anonId).not.toBe(anonId);
  });

  it('rejects a forged, altered or malformed value', async () => {
    const { mintAnonCookie, readAnonCookie } = await import('./anon');
    const { anonId, value } = mintAnonCookie();
    expect(readAnonCookie(`someone-else.${value.split('.')[1]}`)).toBeNull();
    expect(readAnonCookie(`${anonId}.AAAA`)).toBeNull();
    expect(readAnonCookie(anonId)).toBeNull();
    expect(readAnonCookie('')).toBeNull();
    expect(readAnonCookie(undefined)).toBeNull();
    expect(readAnonCookie('.sig')).toBeNull();
  });

  it('a value signed with another secret is not ours', async () => {
    const first = await import('./anon');
    const { value } = first.mintAnonCookie();
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'secret-two');
    const second = await import('./anon');
    expect(second.readAnonCookie(value)).toBeNull();
  });

  it('in production a missing secret is an error, never a default', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    const { mintAnonCookie } = await import('./anon');
    expect(() => mintAnonCookie()).toThrow('AUTH_SECRET is not set');
  });

  it('in development it makes a secret once and keeps it', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOTEL_FINDER_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'hf-anon-')));
    const first = await import('./anon');
    const { anonId, value } = first.mintAnonCookie();
    vi.resetModules();
    const second = await import('./anon');
    expect(second.readAnonCookie(value)).toBe(anonId);
  });
});

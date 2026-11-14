import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const logged: Array<Record<string, unknown>> = [];
vi.mock('@/server/repos/usage', () => ({ logUsage: async (row: Record<string, unknown>) => void logged.push(row) }));

import { GOOGLE_PRIMARY_TYPES, SIGHTS_RADIUS_M } from '@/lib/sights';
import { GOOGLE_NEARBY_MICROCENTS } from '@/lib/supplierPrices';
import { manifest, replay } from './fixtures';
import { FIELD_MASK, NEARBY_URL, nearbyBody, searchNearby } from './google';
import { getSightsFinder } from './index';

const PORTO = { latitude: 41.1579438, longitude: -8.629105299999999 };
const KEY = 'test-key-never-real';

describe('Google Places nearby search', () => {
  it('sends exactly the request the recordings were made with', async () => {
    const { fetchImpl, calls } = replay('nearby-museums-porto');
    const out = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, fetchImpl });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const recorded = manifest.files['nearby-museums-porto.json'];
    expect(calls[0].url).toBe(recorded.url);
    expect(calls[0].url).toBe(NEARBY_URL);
    expect(JSON.parse(calls[0].init.body as string)).toEqual(recorded.request);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe(recorded.fieldMask);
    expect(FIELD_MASK).toBe(recorded.fieldMask);
    // The key travels in a header, never in the URL or the body.
    expect(headers['X-Goog-Api-Key']).toBe(KEY);
    expect(calls[0].url + (calls[0].init.body as string)).not.toContain(KEY);
  });

  it('asks in the language given, for the kind given, inside a hard circle', () => {
    expect(nearbyBody('galleries', PORTO, 'en')).toEqual(manifest.files['nearby-galleries-porto.json'].request);
    expect(nearbyBody('museums', PORTO, 'es')).toEqual(manifest.files['nearby-museums-porto-es.json'].request);
    expect(nearbyBody('museums', PORTO, 'en').includedPrimaryTypes).toEqual([...GOOGLE_PRIMARY_TYPES.museums]);
    expect(nearbyBody('museums', PORTO, 'en').locationRestriction.circle.radius).toBe(SIGHTS_RADIUS_M);
  });

  it('reads the recorded museums: Google\'s names, points, ratings and review counts', async () => {
    const out = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, fetchImpl: replay('nearby-museums-porto').fetchImpl });
    if (!out.ok) throw new Error('expected places');
    expect(out.places).toHaveLength(20);
    expect(out.places.find((p) => p.name === 'Serralves Museum of Contemporary Art')).toMatchObject({ rating: 4.4, reviewCount: 7216 });
    for (const p of out.places) {
      expect(p.placeId).toMatch(/^ChIJ/);
      expect(Math.abs(p.latitude - PORTO.latitude)).toBeLessThan(0.2);
    }
  });

  it('the Spanish recording gives the same places under their Spanish names', async () => {
    const en = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, fetchImpl: replay('nearby-museums-porto').fetchImpl });
    const es = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, language: 'es', fetchImpl: replay('nearby-museums-porto-es').fetchImpl });
    if (!en.ok || !es.ok) throw new Error('expected places');
    const serralves = en.places.find((p) => p.name === 'Serralves Museum of Contemporary Art')!;
    expect(es.places.find((p) => p.placeId === serralves.placeId)?.name).toBe('Museo de Arte Contemporáneo de Serralves');
  });

  it('a refused request is a value, with the status and nothing of the body or the key', async () => {
    const out = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, fetchImpl: replay('nearby-error-bad-type').fetchImpl });
    expect(out).toMatchObject({ ok: false, error: 'http', status: 400 });
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toContain('Unsupported');
  });

  it('a network failure and a timeout are values too', async () => {
    const down = await searchNearby({ apiKey: KEY, kind: 'museums', centre: PORTO, fetchImpl: async () => Promise.reject(new Error(`getaddrinfo ENOTFOUND ${KEY}`)) });
    expect(down).toMatchObject({ ok: false, error: 'network', status: null });
    expect(JSON.stringify(down)).not.toContain(KEY);
    const slow = await searchNearby({
      apiKey: KEY,
      kind: 'museums',
      centre: PORTO,
      timeoutMs: 5,
      fetchImpl: (_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    expect(slow).toMatchObject({ ok: false, error: 'timeout' });
  });
});

describe('the metered finder', () => {
  it('writes one ledger row per call at the list price, tied to the session', async () => {
    logged.length = 0;
    const find = getSightsFinder({ apiKey: KEY, sessionId: 's-1', userId: null, fetchImpl: replay('nearby-museums-porto').fetchImpl });
    const out = await find('museums', PORTO);
    expect(out.ok).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'google:places', success: true, costMicrocents: GOOGLE_NEARBY_MICROCENTS, sessionId: 's-1', meta: { op: 'nearby', kind: 'museums', found: 20 } });
    expect(GOOGLE_NEARBY_MICROCENTS).toBe(3_500_000); // 3.5 cents: $35 per 1,000
    expect(JSON.stringify(logged[0])).not.toContain(KEY);
  });

  it('a refused call is on the ledger as a failure, at no cost', async () => {
    logged.length = 0;
    const find = getSightsFinder({ apiKey: KEY, fetchImpl: replay('nearby-error-bad-type').fetchImpl });
    expect(await find('museums', PORTO)).toEqual({ ok: false, error: 'http' });
    expect(logged).toEqual([expect.objectContaining({ provider: 'google:places', success: false, costMicrocents: 0, errorMessage: 'http 400' })]);
  });

  it('with no key nothing is called and nothing is logged', async () => {
    logged.length = 0;
    const before = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    try {
      const find = getSightsFinder({ fetchImpl: async () => Promise.reject(new Error('must not be called')) });
      expect(await find('museums', PORTO)).toEqual({ ok: false, error: 'not_configured' });
      expect(logged).toEqual([]);
    } finally {
      if (before !== undefined) process.env.GOOGLE_MAPS_API_KEY = before;
    }
  });
});

import { expect, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import * as S from '../support/schemas';

/** The routes anyone may call with no search: health, the example answer, place suggestions. */
test.describe('GET /api/health', { tag: ['@api', '@smoke'] }, () => {
  test('200, the database matches the code, never cached', async ({ api }) => {
    const res = await api.health();
    const body = await json(res, S.healthBody);
    expect(body).toEqual({ ok: true, missingTables: [], missingColumns: [], pendingMigrations: 0 });
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('a query string is not part of its schema: 400', async ({ api }) => {
    await expectError(await api.health('?verbose=1'), 400, 'invalid_request');
  });
});

test.describe('GET /api/example', { tag: ['@api', '@smoke'] }, () => {
  test('the recorded example card, cacheable for an hour, made with no supplier call', async ({ api }) => {
    const res = await api.example();
    const body = await json(res, S.exampleBody);
    expect(res.headers()['cache-control']).toBe('public, max-age=3600');
    expect(body.caption).toMatch(/^Example from a real search: /);
    expect(body.total).toMatch(/^[€£$][\d,]+(\.\d{2})?$/);
    expect(body.reason.length).toBeGreaterThan(10);
  });
});

test.describe('GET /api/places', { tag: '@api' }, () => {
  test('up to six places, each with where and what it is; never a hotel', async ({ api }) => {
    const res = await api.places('porto');
    expect(res.status()).toBe(200);
    // (The strict shape, `where` included, is the next test's.)
    const body = (await res.json()) as { places: Array<{ placeId: string; label: string; name: string; where: string | null; kind: string }> };
    expect(body.places.length).toBeGreaterThan(0);
    expect(body.places.length).toBeLessThanOrEqual(6);
    for (const p of body.places) {
      expect(['City', 'Neighbourhood', 'Airport', 'Station', 'Region', 'Place']).toContain(p.kind);
      expect(p.label).toBe(p.where ? `${p.name}, ${p.where}` : p.name);
    }
    expect(body.places.map((p) => p.label)).toContain('Porto, Portugal');
  });

  test('"where" is null when the supplier gives no address, never an empty string', async ({ api }) => {
    // "Porto Rico" comes back with no address: the shape says `where: string | null`.
    await json(await api.places('porto'), S.placesBody);
  });

  test('a visitor with no cookie gets the anonymous one, so the lookup is charged to them', async ({ api }) => {
    const res = await api.places('lisbon');
    expect(res.status()).toBe(200);
    const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('hf_anon='));
    expect(cookie?.value).toMatch(/HttpOnly/i);
    expect(cookie?.value).toMatch(/SameSite=lax/i);
    expect(cookie?.value).toMatch(/Path=\/hotels/);
    // The second lookup reuses it.
    const again = await api.places('lisbon');
    expect(again.headersArray().some((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('hf_anon='))).toBe(false);
  });

  test('a query shorter than 2 or longer than 80 characters, or an unknown parameter, is 400', async ({ api }) => {
    await expectError(await api.places('p'), 400, 'invalid_request');
    await expectError(await api.places('  p  '), 400, 'invalid_request');
    await expectError(await api.places('x'.repeat(81)), 400, 'invalid_request');
    await expectError(await api.request.get('api/places'), 400, 'invalid_request');
    await expectError(await api.request.get('api/places?q=porto&limit=3'), 400, 'invalid_request');
  });
});

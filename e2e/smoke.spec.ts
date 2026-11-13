import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/test';
import { canonicalDates } from './support/dates';

/**
 * @smoke: the few things that must work on every build and on every
 * deployment (`E2E_BASE_URL=https://… npx playwright test`, run by
 * .github/workflows/deployed.yml after each Vercel deploy). Read-only apart
 * from one search session each: safe against production.
 *
 * Written after 2026-11-13, when production ran code for a column its database
 * did not have: the page loaded, place lookups worked, and every typed search
 * answered 500 (docs/deploy.md).
 */

/** Every API answer of 500 or more, with its body (which carries the server's `ref`). */
function serverErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on('response', async (res) => {
    if (res.status() >= 500 && new URL(res.url()).pathname.includes('/api/')) {
      seen.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname} ${await res.text().catch(() => '')}`);
    }
  });
  return seen;
}

test('the database is the one this code was written for', { tag: ['@smoke', '@api'] }, async ({ api }) => {
  const res = await api.health();
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return `${res.status()} and not JSON (is /api/health deployed?): ${text.slice(0, 120)}`;
    }
  })();
  // On failure this prints what is missing: the table, the column, the migrations not applied.
  expect(body, 'GET /hotels/api/health: apply drizzle/ migrations (npm run db:migrate)').toEqual({ ok: true, missingTables: [], missingColumns: [], pendingMigrations: expect.anything() });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
});

test('a typed sentence searches without a server error', { tag: '@smoke' }, async ({ page, app }) => {
  const errors = serverErrors(page);
  await app.goto();
  await app.trip.box().fill('Porto next weekend, two adults');
  const brief = page.waitForResponse((r) => r.url().includes('/api/session/brief'), { timeout: 90_000 });
  await app.trip.box().press('Enter');
  const res = await brief;
  expect(res.status(), `POST /api/session/brief: ${await res.text().catch(() => '')}`).toBeLessThan(500);

  // Whatever the model made of it (or, with no model, the words alone), the app answers: hotels, or the next question.
  await expect(app.chat.region().getByText(/hotels fit|Which one\?|Where are you going\?|Which nights\?|Who is travelling\?|What matters most|Which Porto\?/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Something broke on our side' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a picked place searches without a server error', { tag: '@smoke' }, async ({ page, app }) => {
  const errors = serverErrors(page);
  await app.goto();
  await app.searchPorto(canonicalDates());
  await expect(app.results.card(0).total()).toBeVisible();
  expect(errors).toEqual([]);
});

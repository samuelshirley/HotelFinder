import { expect, test, type Page } from '@playwright/test';

/**
 * The few things that must work on every build, and on every deployment
 * (`E2E_BASE_URL=https://… npx playwright test`, run by
 * .github/workflows/deployed.yml after each Vercel deploy). Read-only apart
 * from one search session: safe against production.
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

test('the database is the one this code was written for', async ({ request }) => {
  const res = await request.get('api/health');
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
});

test('a typed sentence searches without a server error', async ({ page }) => {
  const errors = serverErrors(page);
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('Porto next weekend, two adults');
  const brief = page.waitForResponse((r) => r.url().includes('/api/session/brief'), { timeout: 90_000 });
  await page.getByLabel('Your trip', { exact: true }).press('Enter');
  const res = await brief;
  expect(res.status(), `POST /api/session/brief: ${await res.text().catch(() => '')}`).toBeLessThan(500);

  // Whatever the model made of it, the app answers: hotels, or the next question.
  const convo = page.getByRole('region', { name: 'Conversation' });
  await expect(convo.getByText(/hotels fit|Which one\?|Where are you going\?|Which nights\?|Who is travelling\?|What matters most/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Something broke on our side' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a picked place searches without a server error', async ({ page }) => {
  const errors = serverErrors(page);
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.locator('ol > li').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('ol > li').first()).toContainText(/€\d/);
  expect(errors).toEqual([]);
});

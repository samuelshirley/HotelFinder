import { expect, openSession, test } from '../fixtures/test';
import { AdminPage, CheckoutPage } from '../pages/checkout';
import { COPY } from '../support/copy';
import { ORIGIN } from '../support/env';

/**
 * What every page owes a visitor regardless of what is on it: a language and
 * a title, a tab icon that loads, images that load with a text alternative,
 * links that go somewhere, alerts only in the declared error copy, and (from
 * the automatic diagnostics fixture) no console error, page error or failed
 * request. Page-specific copy is checked in each page's own spec.
 */
const PAGES: Array<{ name: string; open: (ctx: { page: import('@playwright/test').Page; sessionId?: string; bookingId?: string }) => Promise<void> }> = [
  { name: 'the first screen', open: async ({ page }) => void (await page.goto('./')) },
  { name: 'the admin sign-in', open: async ({ page }) => void (await page.goto('./admin')) },
];

test.describe('every page', { tag: ['@content', '@ui'] }, () => {
  for (const p of PAGES) {
    test(`${p.name}: language, title, images, links, alerts`, { tag: '@smoke' }, async ({ page, api }) => {
      await p.open({ page });
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page).toHaveTitle(/\S/);
      await expect(page).toHaveLoadedImages();
      await expect(page).toHaveWorkingLinks(api.request);
      await expect(page).toHaveOnlyErrorCopy();
    });
  }

  test('the shortlist with a hotel open: images, links, alerts', async ({ page, app, searched, api }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    await app.results.card(0).details().click();
    await expect(page.getByText('Loading the hotel…')).toHaveCount(0, { timeout: 60_000 });
    await expect(page).toHaveTitle(COPY.title);
    await expect(page).toHaveLoadedImages();
    await expect(page).toHaveWorkingLinks(api.request);
    await expect(page).toHaveOnlyErrorCopy();
  });

  test('the checkout and the admin overview: images, links, alerts', async ({ page, prebooked, api }) => {
    await new CheckoutPage(page).goto(prebooked.bookingId);
    await expect(page).toHaveLoadedImages();
    await expect(page).toHaveWorkingLinks(api.request);
    await expect(page).toHaveOnlyErrorCopy();
  });

  test('the admin pages, signed in: images, links, alerts', async ({ page, admin: _admin, api }) => {
    for (const path of ['./admin', './admin?days=30', './admin/search/00000000-0000-0000-0000-000000000000']) {
      await page.goto(path);
      await expect(new AdminPage(page).form()).toHaveCount(0);
      await expect(page).toHaveLoadedImages();
      await expect(page).toHaveWorkingLinks(api.request);
    }
  });

  test('the browser tab has an icon that loads, under /hotels', async ({ page, api }) => {
    await page.goto('./');
    const declared = await page.locator('link[rel~="icon"]').evaluateAll((els) => els.map((e) => (e as HTMLLinkElement).href));
    // Without a declared icon the browser asks for /favicon.ico at the site root, outside this app.
    expect(declared.length, 'no <link rel="icon">: browsers then request /favicon.ico, which 404s').toBeGreaterThan(0);
    for (const href of declared) {
      expect(new URL(href).pathname.startsWith('/hotels/')).toBe(true);
      expect((await api.request.get(href)).status()).toBe(200);
    }
  });

  test('the site root goes to /hotels', async ({ api }) => {
    const res = await api.request.get(`${ORIGIN}/`, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/^(https?:\/\/[^/]+)?\/hotels\/?$/);
  });

  test('a page that does not exist is a 404 with the not-found copy', async ({ page, diagnostics }) => {
    diagnostics.allow(/\/hotels\/no-such-page$/, 404, 'asked for on purpose');
    const res = await page.goto('./no-such-page');
    expect(res!.status()).toBe(404);
    await expect(page.getByText(COPY.admin.notFound)).toBeVisible();
  });
});

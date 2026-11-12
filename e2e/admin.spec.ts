import { expect, test, type Page } from '@playwright/test';

/**
 * The admin cost view through the real UI: the gate (sign-in form, 404 for a
 * non-admin), a real sandbox search showing up with its cost, the place
 * lookup made before the search charged to it, and links that stay under
 * /hotels. ADMIN_EMAILS for the run is set in playwright.config.ts.
 */
const ADMIN = 'admin@e2e.test';

async function signIn(page: Page, email: string) {
  await page.goto('./admin');
  await expect(page.getByRole('form', { name: 'Admin sign-in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  // RESEND_API_KEY is blank for e2e: the code is shown on the page, never emailed.
  // A refusal (e.g. too many codes for this email) fails here with its copy, not by timing out.
  const devCode = page.getByText(/Dev mailbox: \d{6}/);
  // Scoped to the form: Next's route announcer is a role="alert" on every page.
  const form = page.getByRole('form', { name: 'Admin sign-in' });
  await expect(devCode.or(form.getByRole('alert'))).toBeVisible();
  await expect(form.getByRole('alert')).toHaveCount(0);
  const dev = await devCode.textContent();
  await page.getByLabel(/Code sent to/).fill(dev!.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('admin is a sign-in form to strangers and a 404 to non-admins', async ({ page }) => {
  await page.goto('./admin');
  await expect(page.getByRole('form', { name: 'Admin sign-in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cost per search' })).toHaveCount(0);

  await signIn(page, 'someone@e2e.test');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cost per search' })).toHaveCount(0);
  const res = await page.goto('./admin');
  expect(res!.status()).toBe(404);
});

test('a real search shows up with its cost, place lookup included', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // A search the way a person makes one: a place lookup in the trip box first, then the search.
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  // Wait until the search is saved: it is listed under "Your trips" only once it has its stay and
  // shortlist. Hotel cards are not the signal: list items render in the panel before that, and the
  // first screen's example answer is an `ol > li` too (both reproduced 2026-11-12).
  await expect(page.getByRole('navigation', { name: 'Your trips' }).getByRole('button', { name: /Porto, Portugal/ })).toBeVisible({ timeout: 60_000 });
  // This browser's own search, by id: other searches in the same database must not decide the test.
  const trips = (await (await page.request.get('./api/session')).json()) as { trips: { id: string; destination: string }[] };
  expect(trips.trips).toHaveLength(1);
  const searchId = trips.trips[0].id;

  await signIn(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Cost per search' })).toBeVisible();
  expect(page.url()).toMatch(/\/hotels\/admin$/);
  await expect(page.getByText(`Signed in as ${ADMIN}`)).toBeVisible();
  await expect(page.getByText('LiteAPI calls here used a sandbox key')).toBeVisible();

  const table = page.getByRole('region', { name: 'Most expensive searches' });
  const row = table.getByRole('row').filter({ has: page.locator(`a[href$="/admin/search/${searchId}"]`) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Porto, Portugal');
  // Two place calls at $0.01 each (the lookup and the details), rates and content free or unpriced.
  await expect(row.getByRole('cell').nth(2)).toHaveText(/^\$0\.0[2-9]\d*$/);
  await page.screenshot({ path: 'test-results/admin-01-overview.png', fullPage: true });

  await row.getByRole('link', { name: 'Porto, Portugal' }).click();
  await expect(page).toHaveURL(new RegExp(`/hotels/admin/search/${searchId}$`));
  const calls = page.getByRole('table', { name: 'Calls' });
  const lookup = calls.getByRole('row').filter({ hasText: 'liteapi:places' });
  await expect(lookup).toHaveCount(1);
  await expect(lookup).toContainText('before search');
  await expect(lookup).toContainText('$0.0100');
  await expect(calls.getByRole('row').filter({ hasText: 'liteapi:search' })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/admin-02-search.png', fullPage: true });

  await page.getByRole('link', { name: '← All searches' }).click();
  await expect(page).toHaveURL(/\/hotels\/admin$/);
  await page.getByRole('link', { name: '24 hours' }).click();
  await expect(page).toHaveURL(/\/hotels\/admin\?days=1$/);
  await expect(page.getByRole('link', { name: '24 hours' })).toHaveAttribute('aria-current', 'page');
  await expect(table.getByRole('row').filter({ has: page.locator(`a[href$="/admin/search/${searchId}"]`) })).toHaveCount(1);

  expect(errors).toEqual([]);
});

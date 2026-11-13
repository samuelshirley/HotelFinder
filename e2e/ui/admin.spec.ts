import { expect, test } from '../fixtures/test';
import { AdminPage } from '../pages/checkout';
import { COPY, ERROR_COPY } from '../support/copy';
import { ADMIN_EMAILS, uniqueEmail } from '../support/env';

/**
 * /admin and /admin/search/[id] (docs/usage.md): a sign-in form to strangers,
 * a 404 to anyone not in ADMIN_EMAILS, and to an admin the cost of each
 * search with its place lookups charged to it. ADMIN_EMAILS for the run is
 * set in playwright.config.ts.
 */
test.describe('admin', { tag: ['@ui', '@admin'] }, () => {
  test('a stranger gets the sign-in form, on both admin pages, and nothing else', async ({ page, api }) => {
    const admin = new AdminPage(page);
    for (const path of ['./admin', './admin/search/00000000-0000-0000-0000-000000000000']) {
      const res = await page.goto(path);
      expect(res!.status()).toBe(200);
      await expect(admin.form()).toBeVisible();
      await expect(admin.form().getByRole('heading', { level: 1 })).toHaveText(COPY.admin.signInH1);
      await expect(admin.email()).toHaveAttribute('type', 'email');
      await expect(admin.submit()).toHaveText('Send code');
      await expect(page.getByRole('heading', { name: COPY.admin.h1 })).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
    }
    await expect(page).toHaveTitle(/Admin|Search cost/);
    // Never indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveWorkingLinks(api.request);
  });

  test('the sign-in form: a bad email and a wrong code each say why', async ({ page, diagnostics }) => {
    diagnostics.allow(/\/api\/auth\/code$/, 400, 'a malformed email is refused');
    diagnostics.allow(/\/api\/auth\/verify$/, 400, 'a wrong code is refused');
    const admin = new AdminPage(page);
    await page.goto('./admin');
    // The browser's own check first (type=email, required)…
    await admin.email().fill('not-an-email');
    await admin.submit().click();
    expect(await admin.email().evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    // …and the server's for what the browser lets through.
    await admin.email().fill('a@b');
    await admin.submit().click();
    await expect(admin.alert()).toHaveText(ERROR_COPY.email_invalid);
    const email = uniqueEmail('admin-wrong');
    await admin.email().fill(email);
    await admin.submit().click();
    await expect(admin.devCode()).toBeVisible();
    await expect(admin.code()).toHaveAccessibleName(`Code sent to ${email}`);
    await expect(admin.submit()).toHaveText('Sign in');
    const code = (await admin.devCode().textContent())!.match(/\d{6}/)![0];
    await admin.code().fill(code === '000000' ? '111111' : '000000');
    await admin.submit().click();
    await expect(admin.alert()).toHaveText(ERROR_COPY.code_wrong);
  });

  test('a signed-in non-admin gets a 404, as if /admin did not exist', async ({ page, diagnostics }) => {
    diagnostics.allow(/\/hotels\/admin(\/search\/[^/]+)?$/, 404, 'a non-admin is answered 404 on purpose');
    const admin = new AdminPage(page);
    await admin.signIn(uniqueEmail('not-admin'));
    await expect(page.getByText(COPY.admin.notFound)).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.admin.h1 })).toHaveCount(0);
    expect((await page.goto('./admin'))!.status()).toBe(404);
    expect((await page.goto('./admin/search/00000000-0000-0000-0000-000000000000'))!.status()).toBe(404);
  });

  test('an admin signs in through the form and sees the cost of a real search, place lookup included', async ({ page, app, visitor }) => {
    // A search the way a person makes one: a place lookup in the trip box first, then the search.
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.find().click();
    await expect(app.sidebar.trip(/Porto, Portugal/)).toBeVisible({ timeout: 90_000 });
    await visitor.fromBrowser();
    const trips = (await (await visitor.api().trips()).json()) as { trips: { id: string }[] };
    expect(trips.trips).toHaveLength(1);
    const searchId = trips.trips[0].id;

    const admin = new AdminPage(page);
    const email = ADMIN_EMAILS[ADMIN_EMAILS.length - 1];
    await admin.signIn(email);
    await expect(page.getByRole('heading', { name: COPY.admin.h1 })).toBeVisible();
    expect(page.url()).toMatch(/\/hotels\/admin$/);
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(page.getByText('LiteAPI calls here used a sandbox key: shown at list price, not billed.')).toBeVisible();
    for (const label of ['Searches', 'Median per search', 'p90 per search', 'Most expensive', 'All searches', 'Not tied to a search']) {
      await expect(admin.tile(label).getByRole('strong')).toHaveText(/^(\$\d+\.\d{2,4}|\d+)$/);
    }
    await expect(admin.window('7 days')).toHaveAttribute('aria-current', 'page');

    const row = admin.rowFor(searchId);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Porto, Portugal');
    // Two place calls at $0.01 each (the lookup and the details); rates and content free (docs/usage.md).
    await expect(row.getByRole('cell').nth(2)).toHaveText(/^\$0\.0[2-9]\d*$/);
    await expect(row.getByRole('cell').nth(1)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    // Anthropic's own figures: with no ANTHROPIC_ADMIN_KEY in this run, the note says why not.
    await expect(page.getByRole('region', { name: 'Anthropic check' })).toContainText(COPY.admin.notConfigured);

    await row.getByRole('link', { name: 'Porto, Portugal' }).click();
    await expect(page).toHaveURL(new RegExp(`/hotels/admin/search/${searchId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Search ${searchId.slice(0, 8)}`);
    await expect(page.getByText(/^\d+ calls · \$\d+\.\d+ calculated$/)).toBeVisible();
    const calls = admin.calls();
    const lookup = calls.getByRole('row').filter({ hasText: 'liteapi:places' });
    await expect(lookup).toHaveCount(1);
    await expect(lookup).toContainText('before search');
    await expect(lookup).toContainText('$0.0100');
    await expect(calls.getByRole('row').filter({ hasText: 'liteapi:search' })).toHaveCount(1);

    await page.getByRole('link', { name: '← All searches' }).click();
    await expect(page).toHaveURL(/\/hotels\/admin$/);
  });

  test('the window links: 24 hours, 7 days, 30 days', async ({ page, admin: _admin }) => {
    const admin = new AdminPage(page);
    await page.goto('./admin');
    for (const [name, days] of [['24 hours', 1], ['30 days', 30], ['7 days', 7]] as const) {
      await admin.window(name).click();
      await expect(page).toHaveURL(new RegExp(`/hotels/admin\\?days=${days}$`));
      await expect(admin.window(name)).toHaveAttribute('aria-current', 'page');
    }
    // Anything else falls back to 7 days.
    await page.goto('./admin?days=999');
    await expect(admin.window('7 days')).toHaveAttribute('aria-current', 'page');
  });

  test('a search with no calls, and a search id that is not one', async ({ page, admin: _admin, diagnostics }) => {
    diagnostics.allow(/\/hotels\/admin\/search\/not-a-uuid$/, 404, 'not a search id');
    await page.goto('./admin/search/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('No calls recorded for this search.')).toBeVisible();
    await expect(page.getByText(/^0 calls · \$0(\.0+)? calculated$/)).toBeVisible();
    expect((await page.goto('./admin/search/not-a-uuid'))!.status()).toBe(404);
  });
});

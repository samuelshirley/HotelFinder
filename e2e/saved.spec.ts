import { expect, test, type Page } from '@playwright/test';

/**
 * Saved hotels (the heart) and the currency picker, through the real UI
 * against the live sandbox (docs/saved.md, docs/supplier.md "Currency").
 * Anonymous throughout: the signed cookie owns the saved list. No AI call.
 */
async function searchPorto(page: Page) {
  await page.goto('./?detail=slideout');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Low price' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 60_000 });
}

test('save a hotel with the heart, see it with its last price found, change the currency, and unsave it', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await searchPorto(page);
  const sidebar = page.getByRole('navigation', { name: 'Your trips' });
  await expect(sidebar.getByText('Press the heart on a hotel to keep it here.')).toBeVisible();

  const cards = page.getByRole('region', { name: 'Hotels' }).locator('ol > li');
  await expect(cards).toHaveCount(5);
  const first = cards.first();
  const name = (await first.locator('h3').innerText()).replace(/^\d+\s*/, '').trim();
  const heart = first.getByRole('button', { name: `Save ${name}` });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(first.getByRole('button', { name: `Remove ${name} from saved hotels` })).toHaveAttribute('aria-pressed', 'true');

  // The saved list: the hotel, and its price said as the last one found, with its nights and the day.
  const saved = sidebar.getByRole('list', { name: 'Saved hotels' });
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved).toContainText(name);
  await expect(saved).toContainText(/Last price found: €[\d,.]+ for .+ 2 nights, on \d+ \w{3}/);
  await page.screenshot({ path: 'test-results/saved-01-heart.png' });

  // The heart is in the detail view too, and already on.
  await first.getByRole('button', { name: 'Details' }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('button', { name: `Remove ${name} from saved hotels` })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // The currency: a new search priced by the supplier, every card in dollars.
  const chip = page.getByRole('button', { name: 'Change currency' });
  await expect(chip).toHaveText('Prices in EUR ✎');
  await chip.click();
  await page.getByLabel('Currency', { exact: true }).selectOption('USD');
  await page.getByRole('dialog', { name: 'Change currency' }).getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/Prices in USD\. \d+ of \d+ hotels fit/)).toBeVisible({ timeout: 60_000 });
  await expect(chip).toHaveText('Prices in USD ✎');
  await expect(cards).toHaveCount(5);
  const totals = await cards.locator('p').filter({ hasText: /^\$[\d,.]+$/ }).allTextContents();
  expect(totals).toHaveLength(5);
  await expect(page.getByRole('region', { name: 'Hotels' })).not.toContainText('€');
  // The saved hotel's last price found is now the newest one: the dollar search, if it found that hotel.
  await expect(saved).toContainText(/Last price found: \$[\d,.]+ for /);
  await page.screenshot({ path: 'test-results/saved-02-usd.png' });

  // A reload keeps the saved hotel (the cookie owns it) and the currency (the search holds it).
  await page.reload();
  await expect(page.getByRole('button', { name: 'Change currency' })).toHaveText('Prices in USD ✎');
  await expect(sidebar.getByRole('list', { name: 'Saved hotels' })).toContainText(name);
  await expect(sidebar.getByRole('list', { name: 'Saved hotels' })).toContainText(/Last price found: \$[\d,.]+/);

  // Unsaved from the list beside the trips.
  await sidebar.getByRole('button', { name: `Remove ${name} from saved hotels` }).click();
  await expect(sidebar.getByText('Press the heart on a hotel to keep it here.')).toBeVisible();
  await expect(cards.first().getByRole('button', { name: /^Save / })).toHaveAttribute('aria-pressed', 'false');

  expect(errors).toEqual([]);
});

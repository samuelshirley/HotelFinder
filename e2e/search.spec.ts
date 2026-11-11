import { expect, test } from '@playwright/test';

/**
 * The whole first experience, through the real UI: five form questions, a
 * shortlist of real sandbox hotels with a reason and a price each, a typed
 * message, the detail sheet, and a reload that brings the search back.
 */
test('search for a hotel in Porto', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.getByText('Where are you going?')).toBeVisible();
  await expect(page.getByText('Your shortlist appears here')).toBeVisible();

  // Destination: type, pick a suggestion from the supplier.
  await page.getByLabel('Destination').fill('porto');
  await page.getByRole('button', { name: 'Porto, Portugal' }).click();

  // Dates: the defaults (two nights, two weeks out) are valid as they stand.
  await expect(page.getByText('Which nights?')).toBeVisible();
  await page.getByRole('button', { name: 'Use these nights' }).click();

  // Guests: two adults by default; add one, take one away.
  await expect(page.getByText('Who is travelling?')).toBeVisible();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'Fewer adults' }).click();
  await page.getByRole('button', { name: 'That is everyone' }).click();

  await page.getByRole('button', { name: 'Spain' }).click();
  await page.getByRole('button', { name: 'Lowest price' }).click();

  // The first search: a line saying what was found, and cards on the right.
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are on the right/)).toBeVisible({ timeout: 60_000 });
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('Cheapest available');
  await expect(cards.first()).toContainText(/€\d/);
  await expect(cards.first()).toContainText(/total for 2 nights/);
  await expect(cards.nth(1)).toContainText('Than the first:');
  await expect(page.getByRole('heading', { name: 'Porto, Portugal' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hotels' }).getByText('Lowest price first')).toBeVisible();
  await page.screenshot({ path: 'test-results/01-shortlist.png' });

  // Prices on the cards are in ascending order: the ranking the user asked for.
  const totals = await cards.locator('p').filter({ hasText: /^€[\d,.]+$/ }).allTextContents();
  const numbers = totals.map((t) => Number(t.replace(/[€,]/g, '')));
  expect(numbers).toHaveLength(5);
  expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);

  // A typed message. With Jev off the app says so plainly and changes nothing.
  await page.getByLabel('Message').fill('under 120 a night');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('under 120 a night')).toBeVisible();
  await expect(page.getByText(/JEV_API_KEY is not set|Capped at €120 a night/)).toBeVisible();

  // The detail sheet.
  await cards.first().getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Facilities' })).toBeVisible({ timeout: 60_000 });
  await expect(sheet.locator('img').first()).toBeVisible();
  // The photo strip keeps its height (it once collapsed to a few pixels in a tall sheet).
  expect((await sheet.locator('img').first().boundingBox())!.height).toBeGreaterThan(150);
  await expect(sheet.getByRole('button', { name: /Book/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/02-detail.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Reload: the search is still there.
  await page.reload();
  await expect(cards).toHaveCount(5);
  await expect(page.getByText('under 120 a night')).toBeVisible();

  // New search starts clean.
  await page.getByRole('button', { name: 'New search' }).click();
  await expect(page.getByText('Your shortlist appears here')).toBeVisible();
  await expect(page.getByLabel('Destination')).toBeVisible();

  expect(errors).toEqual([]);
});

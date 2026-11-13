import { expect, test, type Page } from '@playwright/test';

/**
 * The filter chips (docs/finder.md, "Filters"), in a real browser against the
 * live sandbox: a star class and a brand set from the header, the cards that
 * fit honouring them, a hotel that misses saying what it misses, and both
 * cleared again. No model is involved: chips are typed actions.
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
  await expect(page.getByText(/\d+ of \d+ hotels fit/)).toBeVisible({ timeout: 60_000 });
}

test('filter chips: star class and brand', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await searchPorto(page);
  const filters = page.getByRole('group', { name: 'Filters' });
  const stars = filters.getByRole('button', { name: 'Change star class' });
  const rating = filters.getByRole('button', { name: 'Change guest rating' });
  await expect(stars).toHaveText('Any stars ✎');
  await expect(rating).toHaveText('Any rating ✎');

  // Five stars only: every card above the divider is a 5★ hotel.
  await stars.click();
  const starEditor = page.getByRole('dialog', { name: 'Change star class' });
  await starEditor.getByLabel('5 stars').check();
  await starEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(stars).toHaveText('5 stars ✎', { timeout: 60_000 });
  await expect(page.getByText(/5 stars only\./).last()).toBeVisible();
  const cards = page.locator('ol > li[id^="hotel-"]');
  await expect(cards.first()).toBeVisible();
  const fitting = page.locator('ol > li[id^="hotel-"]:not([data-near-miss])');
  const n = await fitting.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(fitting.nth(i)).toContainText('5★');
  // A hotel under the divider says what it misses, in words from the listing.
  const misses = page.locator('ol > li[data-near-miss="true"]');
  for (let i = 0; i < (await misses.count()); i++) {
    await expect(misses.nth(i)).toContainText(/Misses: (\d stars?|the listing does not give a star class)/);
  }
  await page.screenshot({ path: 'test-results/filters-01-five-stars.png' });

  // Back to any class, then one brand from the ones the results list.
  await stars.click();
  await page.getByRole('dialog', { name: 'Change star class' }).getByLabel('Any star class').check();
  await page.getByRole('dialog', { name: 'Change star class' }).getByRole('button', { name: 'Apply' }).click();
  await expect(stars).toHaveText('Any stars ✎', { timeout: 60_000 });

  const brand = filters.getByRole('button', { name: 'Change brand' });
  await expect(brand).toHaveText('Any brand ✎');
  await brand.click();
  const brandEditor = page.getByRole('dialog', { name: 'Change brand' });
  const first = brandEditor.getByRole('checkbox').first();
  const chain = ((await first.locator('xpath=..').textContent()) ?? '').replace(/\d+$/, '').trim();
  expect(chain.length).toBeGreaterThan(0);
  await first.check();
  await brandEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(brand).toHaveText(`${chain} ✎`, { timeout: 60_000 });
  await expect(page.getByText(`${chain} only.`, { exact: false }).last()).toBeVisible();
  const others = page.locator('ol > li[data-near-miss="true"]');
  for (let i = 0; i < (await others.count()); i++) {
    // Another brand, or none named; or the brand but a members-only rate
    // (2026-11-13: a hotel of the picked chain, missing only for its price).
    await expect(others.nth(i)).toContainText(/Misses: .*(it is .+|the listing names no brand|its rate is a member price)/);
  }
  await page.screenshot({ path: 'test-results/filters-02-brand.png' });

  // A reload keeps the filter; clearing it brings the full list back.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Change brand' })).toHaveText(`${chain} ✎`, { timeout: 60_000 });
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Change brand' }).click();
  await page.getByRole('dialog', { name: 'Change brand' }).getByRole('checkbox', { checked: true }).uncheck();
  await page.getByRole('dialog', { name: 'Change brand' }).getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Change brand' })).toHaveText('Any brand ✎', { timeout: 60_000 });
  await expect(page.locator('ol > li[data-near-miss="true"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

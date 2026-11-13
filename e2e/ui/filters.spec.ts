import { expect, openSession, test } from '../fixtures/test';

/**
 * The filter chips (docs/finder.md, "Filters"): star class, guest rating, kind
 * of place and brand, each an editor in the header like the other chips. The
 * cards that fit honour the filter; a hotel shown under the divider says what
 * it misses. No model: chips are typed actions.
 */
test.describe('filters', { tag: '@ui' }, () => {
  test('star class: five stars only, every fitting card a 5★; back to any', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    const stars = app.results.filter('star class');
    await expect(stars).toHaveText('Any stars ✎');
    await stars.click();
    const editor = app.results.filterEditor('star class');
    await expect(editor.getByRole('radio')).toHaveCount(4);
    await expect(editor.getByLabel('Any star class')).toBeChecked();
    await expect(editor).toContainText('A hotel whose listing gives no star class is shown under the others, saying so.');
    await editor.getByLabel('5 stars').check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(stars).toHaveText('5 stars ✎', { timeout: 90_000 });
    await expect(app.chat.region().getByText(/5 stars only\./).last()).toBeVisible();
    await app.results.waitForCards();
    const fitting = app.results.cards().and(page.locator(':not([data-near-miss])'));
    const n = await fitting.count();
    for (let i = 0; i < n; i++) await expect(fitting.nth(i)).toContainText('5★');
    const misses = app.results.cards().and(page.locator('[data-near-miss="true"]'));
    for (let i = 0; i < (await misses.count()); i++) await expect(misses.nth(i)).toContainText(/Misses: (\d stars?|the listing does not give a star class)/);

    await stars.click();
    await editor.getByLabel('Any star class').check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(stars).toHaveText('Any stars ✎', { timeout: 90_000 });
  });

  test('guest rating: rated 9+ only; every fitting card rated 9 or more', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const rating = app.results.filter('guest rating');
    await expect(rating).toHaveText('Any rating ✎');
    await rating.click();
    const editor = app.results.filterEditor('guest rating');
    await expect(editor.getByLabel('Any guest rating')).toBeChecked();
    await expect(editor).toContainText('Guest ratings are out of 10, as the listing gives them.');
    const nine = editor.getByRole('radio').last();
    const label = ((await nine.locator('xpath=..').textContent()) ?? '').trim();
    await nine.check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(rating).toHaveText(`${label} ✎`, { timeout: 90_000 });
    await app.results.waitForCards();
    const fitting = app.results.cards().and(page.locator(':not([data-near-miss])'));
    for (let i = 0; i < (await fitting.count()); i++) {
      const value = Number(((await app.results.card(i).lines().first().textContent()) ?? '').match(/^(\d+(?:\.\d)?)/)?.[1]);
      expect(value).toBeGreaterThanOrEqual(9);
    }
  });

  test('kind of place: one kind ticked, the chip names it; none ticked is every kind', async ({ page, app, searched }) => {
    expect(searched.view.stay!.filterOptions.propertyTypes.length, 'Porto lists more than one kind of place').toBeGreaterThan(1);
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const kind = app.results.filter('kind of place');
    await expect(kind).toHaveText('Any kind of place ✎');
    await kind.click();
    const editor = app.results.filterEditor('kind of place');
    await expect(editor).toContainText('None ticked shows every kind.');
    // Each kind with how many of the held hotels are one.
    await expect(editor.getByRole('checkbox')).toHaveCount(searched.view.stay!.filterOptions.propertyTypes.length);
    const box = editor.getByRole('checkbox').first();
    const picked = ((await box.locator('xpath=..').textContent()) ?? '').replace(/\d+$/, '').trim();
    await box.check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    // The chip names the kind, capitalised as a label ("Hotels ✎").
    await expect(kind).toHaveText(new RegExp(`^${picked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ✎$`, 'i'), { timeout: 90_000 });
    await kind.click();
    await editor.getByRole('checkbox', { checked: true }).uncheck();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(kind).toHaveText('Any kind of place ✎', { timeout: 90_000 });
  });

  test('brand: one brand ticked; another brand under the divider says why; kept over a reload; cleared', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const brand = app.results.filter('brand');
    await expect(brand).toHaveText('Any brand ✎');
    await brand.click();
    const editor = app.results.filterEditor('brand');
    await expect(editor).toContainText('None ticked shows every brand.');
    const first = editor.getByRole('checkbox').first();
    const chain = ((await first.locator('xpath=..').textContent()) ?? '').replace(/\d+$/, '').trim();
    expect(chain.length).toBeGreaterThan(0);
    await first.check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(brand).toHaveText(`${chain} ✎`, { timeout: 90_000 });
    await expect(app.chat.region().getByText(`${chain} only.`, { exact: false }).last()).toBeVisible();
    const misses = app.results.cards().and(page.locator('[data-near-miss="true"]'));
    for (let i = 0; i < (await misses.count()); i++) await expect(misses.nth(i)).toContainText(/Misses: .*(it is .+|the listing names no brand|its rate is a member price)/);
    await page.reload();
    await expect(app.results.filter('brand')).toHaveText(`${chain} ✎`);
    await app.results.filter('brand').click();
    await editor.getByRole('checkbox', { checked: true }).uncheck();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.filter('brand')).toHaveText('Any brand ✎', { timeout: 90_000 });
    await expect(app.results.cards().and(page.locator('[data-near-miss="true"]'))).toHaveCount(0);
  });

  test('Cancel and Escape close a filter editor without changing the search', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    let edits = 0;
    page.on('request', (r) => r.url().endsWith('/edit') && edits++);
    const stars = app.results.filter('star class');
    await stars.click();
    await app.results.filterEditor('star class').getByLabel('4+ stars').check();
    await app.results.filterEditor('star class').getByRole('button', { name: 'Cancel' }).click();
    await expect(app.results.filterEditor('star class')).toHaveCount(0);
    await app.results.filter('guest rating').click();
    await app.results.filterEditor('guest rating').getByRole('radio').nth(1).check();
    await page.keyboard.press('Escape');
    await expect(app.results.filterEditor('guest rating')).toHaveCount(0);
    await expect(app.results.filter('guest rating')).toBeFocused();
    expect(edits).toBe(0);
    await expect(stars).toHaveText('Any stars ✎');
    // Opened again, it shows the search as it is, not the edit thrown away.
    await stars.click();
    await expect(app.results.filterEditor('star class').getByLabel('Any star class')).toBeChecked();
  });
});

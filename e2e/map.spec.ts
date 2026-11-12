import { expect, test, type Page } from '@playwright/test';

/**
 * The map over the list, in a real browser against the live sandbox: real
 * tiles, real pins. What is checked is what a person does with it: find a
 * hotel's card from its pin, fold the map away, and search around another spot.
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

test('the map over the list', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await searchPorto(page);
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  const map = page.getByTestId('map');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const pins = map.locator('button[data-pin]');
  await expect(pins).toHaveCount(5);

  // Layout C at 1360 wide: header, then the map band, then the list; the map never taller than its band.
  const band = (await map.boundingBox())!;
  const firstCard = (await cards.first().boundingBox())!;
  expect(band.y + band.height).toBeLessThanOrEqual(firstCard.y);
  expect(band.height).toBeGreaterThanOrEqual(200);
  expect(band.height).toBeLessThanOrEqual(320);
  expect(Math.round(band.width)).toBe(Math.round((await page.getByRole('region', { name: 'Hotels' }).boundingBox())!.width));

  // Every pin says its rank and the same total its card shows.
  for (let i = 0; i < 5; i++) {
    const total = (await cards.nth(i).locator('p').filter({ hasText: /^€[\d,.]+$/ }).first().textContent())!.trim();
    await expect(pins.nth(i)).toHaveText(`${i + 1} · ${total}`);
  }
  // All five pins are inside the band after the first fit.
  for (let i = 0; i < 5; i++) {
    const b = (await pins.nth(i).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(band.x);
    expect(b.x + b.width).toBeLessThanOrEqual(band.x + band.width);
    expect(b.y).toBeGreaterThanOrEqual(band.y);
    expect(b.y + b.height).toBeLessThanOrEqual(band.y + band.height);
  }
  await page.screenshot({ path: 'test-results/10-map-band.png' });

  // A pin under the pointer puts a border on its card and brings the card into view.
  await pins.nth(4).hover({ force: true });
  await expect(cards.nth(4)).toHaveAttribute('data-marked', 'hover');
  await expect(cards.nth(4)).toBeInViewport();
  await page.screenshot({ path: 'test-results/11-pin-hover.png' });
  // A card under the pointer lights its pin.
  await cards.nth(3).hover();
  await expect(pins.nth(3)).toHaveAttribute('data-hover', 'true');
  await expect(cards.nth(4)).not.toHaveAttribute('data-marked', 'hover');
  // A pressed pin stays marked after the pointer leaves, and opens nothing.
  await pins.nth(1).click({ force: true });
  await page.mouse.move(5, 5);
  await expect(cards.nth(1)).toHaveAttribute('data-marked', 'selected');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The wheel over the map zooms the map; the list does not scroll.
  const list = page.locator('ol').locator('..');
  const scrolledBefore = await list.evaluate((el) => el.scrollTop);
  await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolledBefore);
  // The user moved the map, so the way back is offered.
  await expect(map.getByRole('button', { name: 'Recentre' })).toBeVisible();

  // Drag well away: "Search around here" appears, and pressing it is a change like any other.
  await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
  await page.mouse.down();
  await page.mouse.move(band.x + band.width / 2 - 260, band.y + band.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  const around = map.getByRole('button', { name: 'Search around here' });
  await expect(around).toBeVisible();
  await page.screenshot({ path: 'test-results/12-search-around.png' });
  await around.click();
  const convo = page.getByRole('region', { name: 'Conversation' });
  await expect(convo.getByText(/Close to the spot on your map\./)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Near the spot on your map/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change what matters most' })).toHaveText(/Close to the spot on your map/);
  // The place distance is measured from is on the map now, and the camera went to the new search.
  await expect(map.locator('[data-anchor]')).toBeVisible();
  await expect(map.getByRole('button', { name: 'Search around here' })).toHaveCount(0);
  await expect(pins.first()).toBeVisible();
  await page.screenshot({ path: 'test-results/13-around-the-spot.png' });
  // Undo it from the chip: the anchor leaves the map.
  await page.getByRole('button', { name: /^Near the spot on your map/ }).click();
  await expect(map.locator('[data-anchor]')).toHaveCount(0, { timeout: 60_000 });

  // Fold the map away; it stays away over a reload, and comes back when asked.
  await page.getByRole('button', { name: 'Hide map' }).click();
  await expect(map).toHaveCount(0);
  await page.reload();
  await expect(cards.first()).toBeVisible();
  await expect(page.getByTestId('map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show map' }).click();
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });

  // A wide window: the map stands beside the list, and the card keeps its price column.
  await page.setViewportSize({ width: 2000, height: 900 });
  const wideMap = (await page.getByTestId('map').boundingBox())!;
  const wideCard = (await cards.first().boundingBox())!;
  expect(wideMap.x).toBeGreaterThanOrEqual(wideCard.x + wideCard.width);
  expect(wideMap.height).toBeGreaterThan(500);
  expect(wideCard.width).toBeGreaterThanOrEqual(560);
  await page.screenshot({ path: 'test-results/14-wide-side-by-side.png' });

  expect(errors).toEqual([]);
});

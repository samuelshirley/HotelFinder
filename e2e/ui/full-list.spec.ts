import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/test';

/**
 * "Show all N hotels" (lib/fullList.ts) in a real browser against the live
 * sandbox: the top picks stay as they are, the control opens every other hotel
 * that fits in the same order, the map shows the page on screen, and a hotel
 * from the full list opens and books like a top pick.
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

const euros = (text: string) => Number(text.replace(/[^\d.]/g, ''));
const totalOf = async (card: ReturnType<Page['locator']>) => (await card.locator('p').filter({ hasText: /^€[\d,.]+$/ }).first().textContent())!.trim();

test('show all hotels under the top picks', { tag: ['@ui'] }, async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await searchPorto(page);
  const hotels = page.getByRole('region', { name: 'Hotels' });
  const picks = hotels.locator('ol').first().locator('> li');
  await expect(picks).toHaveCount(5);
  const fit = (await page.getByText(/\d+ of \d+ hotels fit/).last().textContent())!;
  const n = Number(/(\d+) of \d+ hotels fit/.exec(fit)![1]);
  test.skip(n <= 5, `the sandbox had only ${n} hotels that fit today: nothing to show after the picks`);

  // The control names every hotel that fits, the picks included, as the chat counted them.
  const all = page.getByRole('region', { name: 'Full list' });
  await expect(all.getByRole('button', { name: `Show all ${n} hotels` })).toBeVisible();
  const map = page.getByTestId('map');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(map.locator('button[data-pin]')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/30-show-all-closed.png' });

  await all.getByRole('button', { name: `Show all ${n} hotels` }).click();
  await expect(all.getByRole('heading', { name: `All ${n} hotels that fit` })).toBeVisible();
  const rest = all.locator('ol > li');
  const onPage = Math.min(n - 5, 20);
  await expect(rest).toHaveCount(onPage, { timeout: 30_000 });
  await expect(all).toContainText(`Hotels 6–${5 + onPage} of ${n}, in the same order as the picks above.`);
  // The top picks keep their reasons and their place.
  await expect(picks).toHaveCount(5);
  await expect(picks.first().locator('p').filter({ hasText: /^Cheapest/ })).toBeVisible();

  // Ranked for low price: the long tail continues the order, no cheaper than the last pick.
  const lastPick = euros(await totalOf(picks.nth(4)));
  let previous = lastPick;
  for (let i = 0; i < onPage; i++) {
    const card = rest.nth(i);
    await expect(card.locator('h3')).toContainText(String(6 + i));
    await expect(card).toHaveAttribute('data-compact', 'true');
    await expect(card.locator('img')).toHaveCount(0);
    const total = euros(await totalOf(card));
    expect(total).toBeGreaterThanOrEqual(previous);
    previous = total;
  }

  // The map shows the picks and the page on screen; every pin carries its card's rank and total.
  const pins = map.locator('button[data-pin]');
  await expect(pins).toHaveCount(5 + onPage);
  // Rank 6's pin: "6 · total", or "6" alone where its label would have covered another.
  await expect(map.locator('button[data-pin]', { hasText: /^6( · |$)/ })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/31-show-all-open.png' });
  // The camera frames the page on screen, not the whole city: every one of its pins is inside the map.
  await expect(map).toHaveAttribute('data-frame', 'page');
  const band = (await map.boundingBox())!;
  const pageIds = await rest.evaluateAll((els) => els.map((el) => el.id.replace(/^hotel-/, '')));
  const inside = () =>
    map.locator('button[data-pin]').evaluateAll(
      (els, { ids, b }) =>
        els
          .filter((el) => ids.includes((el as HTMLElement).dataset.pin!))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            return x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height;
          }).length,
      { ids: pageIds, b: band },
    );
  await expect.poll(inside, { timeout: 10_000 }).toBe(0);
  await map.screenshot({ path: 'test-results/31b-show-all-map.png' });

  // A hotel from the full list opens in the same detail view, with its rooms and rates.
  const sixthName = (await rest.first().locator('h3').textContent())!.replace(/^\s*\d+\s*/, '').trim();
  await rest.first().getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog', { name: sixthName });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/Something broke|could not be found/i)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/32-show-all-detail.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Folding it away leaves the picks, and the map goes back to them.
  await all.getByRole('button', { name: 'Top picks only' }).click();
  await expect(rest).toHaveCount(0);
  await expect(pins).toHaveCount(5);
  await expect(map).toHaveAttribute('data-frame', 'all');

  // Penny opens it too. Jev is off in this run, so this is the agent, live, if it can be reached.
  await page.getByLabel('Message').fill('show me all of them');
  await page.getByRole('button', { name: 'Send' }).click();
  const said = page
    .getByRole('region', { name: 'Conversation' })
    .getByText(/hotels that fit are listed under the top picks|The assistant did not answer|The assistant is set up wrongly|ANTHROPIC_API_KEY is not set|used its allowance/);
  await expect(said).toBeVisible({ timeout: 90_000 });
  if (/listed under the top picks/.test((await said.textContent())!)) {
    await expect(said).toHaveText(`All ${n} hotels that fit are listed under the top picks, in the same order.`);
    await expect(rest).toHaveCount(onPage);
    // Nothing was set aside: the same five picks.
    await expect(picks).toHaveCount(5);
    await expect(hotels.getByText(/set aside/)).toHaveCount(0);
  } else {
    console.log('[full-list.spec] the agent was not reachable, so "show me all of them" by chat was not exercised:', await said.textContent());
    await all.getByRole('button', { name: `Show all ${n} hotels` }).click();
    await expect(rest).toHaveCount(onPage);
  }

  // And a hotel from the full list books: the price is re-checked and the checkout opens on it.
  const bookName = (await rest.first().locator('h3').textContent())!.replace(/^\s*\d+\s*/, '').trim();
  await rest.first().getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const stay = page.getByRole('region', { name: 'Your stay' });
  await expect(stay.getByRole('heading', { name: bookName })).toBeVisible();
  await expect(stay).toContainText(/Price re-checked with the hotel just now|The price changed: it was/);
  await page.screenshot({ path: 'test-results/33-show-all-checkout.png' });

  expect(errors).toEqual([]);
});

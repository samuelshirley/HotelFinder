import { expect, test, type Page } from '@playwright/test';

/**
 * Room splits through the real UI, on the live sandbox: four adults with the
 * rooms left at "Best price", each card saying which rooms its price is for,
 * and the checkout re-checking exactly those rooms. Signed in first, so the
 * search is a member one: on 2026-11-13 the sandbox put every multi-room
 * public rate a few cents under the hotel's public price, which hides the
 * price from an anonymous visitor (docs/finder.md, "Room splits"). Nothing
 * is booked: the spec stops at the checkout page (a prebook books nothing).
 */
async function signIn(page: Page, email: string) {
  // The admin form is the one sign-in page with no booking behind it; a non-admin is simply signed in.
  await page.goto('./admin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  const devCode = page.getByText(/Dev mailbox: \d{6}/);
  await expect(devCode).toBeVisible();
  await page.getByLabel(/Code sent to/).fill((await devCode.textContent())!.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('This page could not be found.')).toBeVisible();
}

test('four adults, rooms left to us: each card names its rooms, and the checkout re-checks those rooms', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await signIn(page, 'rooms@e2e.test');
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Who: four adults. Rooms start at "Best price"; a number is the user's own choice.
  await page.getByRole('button', { name: /^Who:/ }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  const rooms = page.locator('div', { has: page.getByRole('button', { name: 'More rooms' }) }).last().locator('output');
  await expect(rooms).toHaveText('Best price');
  await page.getByRole('button', { name: 'More rooms' }).click();
  await expect(rooms).toHaveText('1');
  await page.getByRole('button', { name: 'Fewer rooms' }).click();
  await expect(rooms).toHaveText('Best price');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Who: 4 adults' })).toBeVisible();
  await page.getByRole('button', { name: 'Low price' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();

  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 90_000 });
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  // Every priced card says what its price is for: one room's name, or "2 rooms: …".
  const lines = await page.locator('[data-rooms]').allTextContents();
  console.log('room lines:', lines);
  expect(lines.length).toBe(await cards.filter({ has: page.getByRole('button', { name: 'Book' }) }).count());
  expect(lines.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/20-rooms-cards.png' });

  // Book the first two-room card if there is one, else the first card: the checkout shows the same rooms, re-checked.
  const twoRooms = cards.filter({ has: page.locator('[data-rooms]', { hasText: /^2 rooms: / }) }).first();
  const card = (await twoRooms.count()) > 0 ? twoRooms : cards.filter({ has: page.locator('[data-rooms]') }).first();
  const line = (await card.locator('[data-rooms]').textContent())!.trim();
  await card.getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const stay = page.getByRole('region', { name: 'Your stay' });
  await expect(stay).toContainText(/Price re-checked with the hotel just now|The price changed: it was/);
  await expect(stay).toContainText(/^2 rooms: /.test(line) ? '4 adults, 2 rooms' : '4 adults');
  console.log('checkout rooms:', await stay.innerText());
  await page.screenshot({ path: 'test-results/21-rooms-checkout.png' });
  expect(errors).toEqual([]);
});

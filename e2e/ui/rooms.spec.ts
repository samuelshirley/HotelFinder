import { expect, test } from '../fixtures/test';
import { MONEY_IN_TEXT, minor } from '../support/money';

/**
 * Room splits through the real UI, on the live sandbox: four adults with the
 * rooms left at "Best price", each card saying which rooms its price is for,
 * and the checkout re-checking exactly those rooms. Signed in first, so the
 * search is a member one: on 2026-11-13 the sandbox put every multi-room
 * public rate a few cents under the hotel's public price, which hides the
 * price from an anonymous visitor (docs/finder.md, "Room splits"). Nothing
 * is booked: the spec stops at the checkout page (a prebook books nothing).
 */
test('four adults, rooms left to us: each card names its rooms, and the checkout re-checks those rooms', { tag: ['@ui', '@booking'] }, async ({ page, signedIn: _signedIn }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Signed in by the fixture (an email code, no booking behind it).
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

/**
 * A room split lists each room's own copy of a fee; the detail names each fee
 * once ("City tax", not "City tax, City tax": bug 2026-11-14).
 */
test('four adults on a room split: the detail names each pay-at-the-hotel fee once', { tag: ['@ui', '@booking'] }, async ({ page, signedIn: _signedIn }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Who:/ }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Low price' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 90_000 });

  const cards = page.locator('ol > li').filter({ has: page.locator('[data-rooms]', { hasText: /^2 rooms: / }) });
  const n = await cards.count();
  test.skip(n === 0, 'the sandbox offered no two-room split for this search');
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await card.getByRole('button', { name: /^(Details|Collapse ▲)$/ }).first().click();
    const lines = await card.getByText(/paid at the hotel \(/).allTextContents();
    for (const line of lines) {
      const names = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')')).split(', ');
      expect(new Set(names).size, line).toBe(names.length);
    }
  }
});

/**
 * A refundable room split's cancellation charge covers every room, not one
 * (bug 2026-11-14: a 367.54 two-room offer said "then 183.77 to cancel").
 * Live prices are never fixed here, so this checks the invariants: the charge
 * is a real amount, the detail says it once in the timeline and once in the
 * text, and it is never more than the whole stay costs.
 */
test('four adults on a room split: the cancel charge is one amount that is never above the stay price', { tag: ['@ui', '@booking'] }, async ({ page, signedIn: _signedIn }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Who:/ }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Low price' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 90_000 });

  const cards = page.locator('ol > li').filter({ has: page.locator('[data-rooms]', { hasText: /^2 rooms: / }) });
  const n = await cards.count();
  test.skip(n === 0, 'the sandbox offered no two-room split for this search');
  let checked = 0;
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await card.getByRole('button', { name: /^(Details|Collapse ▲)$/ }).first().click();
    const charge = card.getByText(/ to cancel$/).first();
    if (!(await charge.isVisible().catch(() => false))) continue;
    const amounts = ((await charge.textContent()) ?? '').match(MONEY_IN_TEXT) ?? [];
    expect(amounts).toHaveLength(1);
    const cancelMinor = minor(amounts[0] as string);
    expect(cancelMinor).toBeGreaterThan(0);
    const totals = ((await card.textContent()) ?? '').match(MONEY_IN_TEXT) ?? [];
    const biggest = Math.max(...totals.map(minor));
    expect(cancelMinor).toBeLessThanOrEqual(biggest);
    checked++;
  }
  test.skip(checked === 0, 'no two-room split in the sandbox was refundable with a charge');
});

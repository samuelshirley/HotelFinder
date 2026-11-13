import { expect, test, type Page } from '@playwright/test';

/**
 * The checkout additions, through the real UI against the LiteAPI SANDBOX:
 * the hotel page's FAQ (answered from the rows, as the chat answers), what is
 * paid now and what at the hotel, and a special request that goes to the
 * hotel with the booking and comes back on the receipt. The payment is the
 * test stand-in (no money moves); the sandbox booking is cancelled at the end.
 * There is no price timer: the supplier's prebook carries no expiry
 * (docs/supplier.md, "Checkout extras").
 */
const EMAIL = `e2e+extras${Date.now()}@fixture.hotelfinder.invalid`;
const REQUEST = 'Late arrival, about 23:00.\nA quiet room if possible.';

async function search(page: Page) {
  await page.goto('./?detail=slideout');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.locator('ol > li').first()).toBeVisible({ timeout: 60_000 });
}

test('checkout extras: the hotel FAQ, pay now and at the hotel, a special request on the receipt', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await search(page);
  const card = page.locator('ol > li').first();
  const hotel = (await card.getByRole('heading', { level: 3 }).textContent())!.replace(/^\s*\d+\s*/, '').trim();

  // The hotel page answers the chat's questions itself, from the same rows.
  await card.getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog');
  const faq = sheet.getByRole('region', { name: 'Questions about this hotel' });
  await expect(faq).toBeVisible({ timeout: 60_000 });
  const priceText = (await sheet.getByRole('region', { name: 'Price' }).locator('p').first().textContent())!;
  const total = /€[\d,.]+/.exec(priceText)![0];
  const answer = (q: string) => faq.locator('div', { has: page.getByText(q, { exact: true }) }).locator('dd');
  await expect(answer('How much is it for these dates?')).toContainText(`${hotel}: ${total} for 2 nights`);
  await expect(answer('Can I cancel for free?')).toHaveText(/free cancellation until .+ UTC\.$|non-refundable at this price\.$|refundable, but the listing does not give the deadline\.$/);
  await expect(answer('What time is check-in?')).toHaveText(/check-in from .+\.$|does not say when check-in starts\.$/);
  await faq.getByRole('button', { name: /^Show all \d+ questions$/ }).click();
  // A facility is listed, not listed, or the listing does not say: never a bare "no".
  await expect(answer('Are pets allowed?')).toHaveText(/ lists pets allowed\.$| does not list pets allowed\.$|does not say whether it has pets allowed\.$/);
  await page.screenshot({ path: 'test-results/20-hotel-faq.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The checkout: the price paid now, and what the hotel charges on top, named.
  await card.getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const stay = page.getByRole('region', { name: 'Your stay' });
  await expect(stay.getByRole('heading', { name: hotel })).toBeVisible();
  await expect(stay).toContainText('Pay now, taxes in');
  await expect(stay.getByText(/^Pay at the hotel/)).toBeVisible();
  const payNow = (await stay.locator('dd strong').textContent())!;
  // No countdown: nothing in the supplier's answer says when this price lapses.
  await expect(page.getByText(/expires in|\d+:\d\d left/i)).toHaveCount(0);

  await page.getByLabel(/^Email\./).fill(EMAIL);
  await page.getByRole('button', { name: 'Send code' }).click();
  const shown = page.getByRole('status').filter({ hasText: 'No email service is set up here' });
  const code = (await shown.locator('strong').textContent())!.trim();
  await page.getByLabel('6-digit code').fill(code);
  await page.getByLabel('First name (as on the guest\'s ID)').fill('Ana');
  await page.getByLabel('Last name').fill('Silva');

  // The request: capped at 500 characters as typed, and said to be not guaranteed.
  const box = page.getByLabel('Special requests (optional)');
  await box.fill('x'.repeat(600));
  expect((await box.inputValue()).length).toBe(500);
  await expect(page.getByText(/Requests are not guaranteed\. · 500\/500/)).toBeVisible();
  await box.fill(REQUEST);
  await page.screenshot({ path: 'test-results/21-checkout-extras.png' });

  await page.getByRole('button', { name: `Pay ${payNow} with Apple Pay` }).click();
  const wallet = page.getByRole('dialog', { name: 'Apple Pay (test)' });
  await expect(wallet).toContainText('TEST · no money moves');
  await wallet.getByRole('button', { name: `Confirm ${payNow}` }).click();
  await expect(page.getByRole('heading', { name: 'Booked', level: 1 })).toBeVisible({ timeout: 90_000 });

  // The receipt: the request as sent, and what it is worth.
  const booking = page.getByRole('region', { name: 'Booking' });
  await expect(booking).toContainText('Your special request');
  await expect(booking).toContainText('Late arrival, about 23:00.');
  await expect(booking).toContainText('A quiet room if possible.');
  await expect(booking).toContainText('Requests are not guaranteed');
  await expect(stay).toContainText('Total, taxes in');
  await page.screenshot({ path: 'test-results/22-receipt-request.png' });
  // A reload reads it back from the booking row.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Booking' })).toContainText('A quiet room if possible.');

  // Cancel the sandbox booking.
  await page.getByRole('button', { name: 'Cancel this booking' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelled', level: 1 })).toBeVisible({ timeout: 60_000 });

  expect(errors).toEqual([]);
});

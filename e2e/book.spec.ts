import { expect, test, type Page } from '@playwright/test';

/**
 * Booking through the real UI against the LiteAPI SANDBOX: Book re-checks the
 * price, the checkout signs in with an email code (shown on the page: no email
 * service in this environment), the Apple Pay sheet is a test stand-in, and
 * the sandbox makes a real test booking, which is then cancelled. Then the
 * signed-in path: Google Pay, no code. Both bookings are cancelled at the end.
 */
const EMAIL = `e2e+${Date.now()}@fixture.hotelfinder.invalid`;

async function search(page: Page) {
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  await page.getByRole('button', { name: /^When:/ }).click();
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.locator('ol > li').first()).toBeVisible({ timeout: 60_000 });
}

test('book a hotel: re-check, sign in with a code, Apple Pay (test), booked, then cancelled', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await search(page);
  const card = page.locator('ol > li').first();
  const hotel = (await card.getByRole('heading', { level: 3 }).textContent())!.replace(/^\s*\d+\s*/, '').trim();
  const cardTotal = (await card.locator('p').filter({ hasText: /^€[\d,.]+$/ }).first().textContent())!;
  await card.getByRole('button', { name: 'Book' }).click();

  // The checkout: what is booked, re-checked with the hotel.
  await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const stay = page.getByRole('region', { name: 'Your stay' });
  await expect(stay.getByRole('heading', { name: hotel })).toBeVisible();
  await expect(stay).toContainText(/Fri \d+ – Sun \d+ \w{3} · 2 nights · 2 adults/);
  await expect(stay).toContainText('Pay now, taxes in');
  await expect(stay).toContainText(/Price re-checked with the hotel just now|The price changed: it was/);
  const total = (await stay.locator('dd strong').textContent())!;
  if ((await stay.getByText(/The price changed/).count()) === 0) expect(total).toBe(cardTotal);
  await page.screenshot({ path: 'test-results/10-checkout.png' });

  // Nothing filled in: the wallet does not open, and the page says what is missing.
  await page.getByRole('button', { name: `Pay ${total} with Apple Pay` }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('That email address does not look complete.')).toBeVisible();

  // The code: sent, shown here because no email service is configured.
  await page.getByLabel(/^Email\./).fill(EMAIL);
  await page.getByRole('button', { name: 'Send code' }).click();
  const shown = page.getByRole('status').filter({ hasText: 'No email service is set up here' });
  await expect(shown).toBeVisible();
  const code = (await shown.locator('strong').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('First name (as on the guest\'s ID)').fill('Ana');
  await page.getByLabel('Last name').fill('Silva');

  // A wrong code: the sheet opens, but nothing is paid or booked, and the code field says why.
  await page.getByLabel('6-digit code').fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: `Pay ${total} with Apple Pay` }).click();
  const sheet = page.getByRole('dialog', { name: 'Apple Pay (test)' });
  await expect(sheet).toContainText('TEST · no money moves');
  await expect(sheet).toContainText(total);
  await page.screenshot({ path: 'test-results/11-apple-pay-sheet.png' });
  await sheet.getByRole('button', { name: `Confirm ${total}` }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('That code is not right.')).toBeVisible();

  // The right code: one press books.
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: `Pay ${total} with Apple Pay` }).click();
  await sheet.getByRole('button', { name: `Confirm ${total}` }).click();
  await expect(page.getByRole('heading', { name: 'Booked', level: 1 })).toBeVisible({ timeout: 90_000 });
  const booking = page.getByRole('region', { name: 'Booking' });
  await expect(booking).toContainText('Booking reference');
  await expect(booking).toContainText('Ana Silva');
  await expect(booking).toContainText(`${total} with Apple Pay (test payment: no money moved)`);
  const reference = (await booking.locator('dt', { hasText: 'Booking reference' }).locator('+ dd').textContent())!.trim();
  expect(reference.length).toBeGreaterThan(3);
  const receiptUrl = page.url();
  await page.screenshot({ path: 'test-results/12-booked.png' });

  // Back to the shortlist: the chat says it, and the account and the booking are in the sidebar.
  await page.getByRole('link', { name: 'Back to the shortlist' }).first().click();
  await expect(page.getByText(`Booked: ${hotel}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Reference ${reference}.`)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Your trips' });
  await expect(nav.getByText(`Signed in as ${EMAIL}`)).toBeVisible();
  await expect(nav.getByRole('link', { name: new RegExp(hotel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();

  // Signed in, a second hotel: no email, no code, Google Pay.
  const second = page.locator('ol > li').nth(1);
  const secondHotel = (await second.getByRole('heading', { level: 3 }).textContent())!.replace(/^\s*\d+\s*/, '').trim();
  await second.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('region', { name: 'Your stay' }).getByRole('heading', { name: secondHotel })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible();
  await expect(page.getByLabel('6-digit code')).toHaveCount(0);
  await expect(page.getByLabel('First name (as on the guest\'s ID)')).toHaveValue('Ana');
  const total2 = (await page.getByRole('region', { name: 'Your stay' }).locator('dd strong').textContent())!;
  await page.getByRole('button', { name: `Pay ${total2} with Google Pay` }).click();
  const gsheet = page.getByRole('dialog', { name: 'Google Pay (test)' });
  await page.screenshot({ path: 'test-results/13-google-pay-sheet.png' });
  await gsheet.getByRole('button', { name: `Confirm ${total2}` }).click();
  await expect(page.getByRole('heading', { name: 'Booked', level: 1 })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('region', { name: 'Booking' })).toContainText(`${total2} with Google Pay (test payment: no money moved)`);

  // Cancel both, through the supplier, from their receipts.
  for (const url of [page.url(), receiptUrl]) {
    await page.goto(url);
    await page.getByRole('button', { name: 'Cancel this booking' }).click();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByRole('heading', { name: 'Booked', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel this booking' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByRole('heading', { name: 'Cancelled', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('region', { name: 'Booking' })).toContainText('Refund');
  }
  await page.screenshot({ path: 'test-results/14-cancelled.png' });

  // Sign out: the account line goes, and the bookings with it.
  await page.goto('./');
  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Your trip', { exact: true })).toBeVisible();
  await expect(nav.getByText(/Signed in as/)).toHaveCount(0);
  await expect(nav.getByText('Your bookings')).toHaveCount(0);

  expect(errors).toEqual([]);
});

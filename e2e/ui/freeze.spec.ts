import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/test';

/**
 * Deal Freeze through the real UI against the LiteAPI SANDBOX
 * (docs/deal-freeze.md): a free-cancellation card is frozen (a real sandbox
 * booking, nothing paid), shown as frozen until 48 h before its deadline,
 * then confirmed with the test wallet and cancelled. Frozen a second time,
 * it is released (cancelled with the hotel). Every sandbox booking made here
 * ends cancelled.
 */
const EMAIL = `e2e+freeze${Date.now()}@fixture.hotelfinder.invalid`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function search(page: Page) {
  await page.goto('./');
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  await page.getByRole('button', { name: /^Porto\s*Portugal · City$/ }).click();
  // About five weeks out, not next weekend: a freeze needs a free-cancellation
  // deadline at least 72 h away, and a week out the sandbox often has none left
  // among the hotels a signed-out visitor sees (CI, 2026-11-13: 0 of 11).
  await page.getByRole('button', { name: /^When:/ }).click();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  const label = (d: Date) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
  const pick = async (d: Date) => {
    const cell = page.getByRole('button', { name: label(d), exact: true });
    for (let i = 0; i < 3 && !(await cell.isVisible()); i++) await page.getByRole('button', { name: 'Next month' }).click();
    await cell.click();
  };
  await pick(day(35));
  await pick(day(37));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Find my hotel' }).click();
  await expect(page.locator('ol > li').first()).toBeVisible({ timeout: 60_000 });
}

/** The first card on the shortlist whose price can be cancelled for free. */
async function refundableCard(page: Page): Promise<{ card: Locator; hotel: string }> {
  const cards = page.locator('ol > li');
  // The cards load after skeletons: wait for real ones.
  await expect(cards.first().getByRole('heading', { level: 3 })).toBeVisible({ timeout: 60_000 });
  const scan = async () => {
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i);
      if ((await card.getByText(/^Free cancellation until /).count()) > 0) {
        const hotel = (await card.getByRole('heading', { level: 3 }).textContent())!.replace(/^\s*\d+\s*/, '').trim();
        return { card, hotel };
      }
    }
    return null;
  };
  const top = await scan();
  if (top) return top;
  // None of the top picks is refundable today (2026-11-13: none of five): the
  // full list under them books the same way and shows the same cancellation line.
  const all = page.getByRole('button', { name: /^Show all \d+ hotels$/ });
  if ((await all.count()) > 0) {
    const before = await cards.count();
    await all.click();
    await expect.poll(() => cards.count(), { timeout: 30_000 }).toBeGreaterThan(before);
    const more = await scan();
    if (more) return more;
  }
  throw new Error('no free-cancellation card on the shortlist or the full list: the sandbox answered without one');
}

test('freeze a free-cancellation room: frozen with no payment, then confirmed; frozen again, then released', { tag: ['@ui', '@booking'] }, async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await search(page);
  const { card, hotel } = await refundableCard(page);
  await card.getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const stay = page.getByRole('region', { name: 'Your stay' });
  await expect(stay.getByRole('heading', { name: hotel })).toBeVisible();
  await expect(stay).toContainText(/Free until/);

  // The freeze is offered: until when, and that nothing is paid.
  const offer = page.getByRole('group', { name: 'Freeze this price' });
  await expect(offer).toContainText('you pay nothing yet');
  const freezeButton = offer.getByRole('button', { name: /^Freeze until / });
  const until = (await freezeButton.textContent())!.replace('Freeze until ', '').trim();
  expect(until).toMatch(/^\w{3} \d+ \w{3}, \d{2}:\d{2} UTC$/);
  await page.screenshot({ path: 'test-results/20-freeze-offer.png' });

  // Not signed in and nothing typed: nothing is booked, and the page says what is missing.
  await freezeButton.click();
  await expect(page.getByText('That email address does not look complete.')).toBeVisible();

  await page.getByLabel(/^Email\./).fill(EMAIL);
  await page.getByRole('button', { name: 'Send code' }).click();
  const shown = page.getByRole('status').filter({ hasText: 'No email service is set up here' });
  const code = (await shown.locator('strong').textContent())!.trim();
  await page.getByLabel('6-digit code').fill(code);
  await page.getByLabel("First name (as on the guest's ID)").fill('Ana');
  await page.getByLabel('Last name').fill('Silva');
  await freezeButton.click();

  // Frozen: a real sandbox booking, nothing paid, held until the time offered.
  await expect(page.getByRole('heading', { name: 'Frozen', level: 1 })).toBeVisible({ timeout: 90_000 });
  const booking = page.getByRole('region', { name: 'Booking' });
  await expect(booking).toContainText('Booking reference');
  await expect(booking.locator('dt', { hasText: 'Held until' }).locator('+ dd')).toHaveText(until);
  await expect(booking.locator('dt', { hasText: 'Paid' }).locator('+ dd')).toHaveText('Nothing yet');
  await expect(booking).toContainText('Ana Silva');
  // No mail service in this run: the reminder is on this page only, and says so.
  await expect(booking).toContainText('No email service is set up here, so no email will be sent: this page is the reminder.');
  const reference = (await booking.locator('dt', { hasText: 'Booking reference' }).locator('+ dd').textContent())!.trim();
  const frozenUrl = page.url();
  await page.screenshot({ path: 'test-results/21-frozen.png' });

  // Reload keeps it frozen; the chat and the sidebar say so.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the shortlist' }).first().click();
  await expect(page.getByText(`Frozen: ${hotel}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`held until ${until.replace(/^\w{3} /, '')}. Reference ${reference}.`, { exact: false })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Your trips' });
  await expect(nav.getByRole('link', { name: new RegExp(`${escape(hotel)}.*· frozen`) })).toBeVisible();

  // Confirm: the test wallet pays the held price; it is an ordinary booking now.
  await page.goto(frozenUrl);
  const total = (await page.getByRole('region', { name: 'Your stay' }).locator('dd strong').textContent())!;
  await page.getByRole('button', { name: `Confirm and pay ${total} with Apple Pay` }).click();
  const sheet = page.getByRole('dialog', { name: 'Apple Pay (test)' });
  await expect(sheet).toContainText('TEST · no money moves');
  await sheet.getByRole('button', { name: `Confirm ${total}` }).click();
  await expect(page.getByRole('heading', { name: 'Booked', level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Booking' })).toContainText(`${total} with Apple Pay (test payment: no money moved)`);
  await expect(page.getByRole('region', { name: 'Booking' })).toContainText(reference);
  await page.screenshot({ path: 'test-results/22-frozen-then-booked.png' });
  // Cleanup: the sandbox booking is cancelled.
  await page.getByRole('button', { name: 'Cancel this booking' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelled', level: 1 })).toBeVisible({ timeout: 60_000 });

  // Frozen again, signed in now: no code. Then released.
  await page.goto('./');
  const again = await refundableCard(page);
  await again.card.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('region', { name: 'Your stay' }).getByRole('heading', { name: again.hotel })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('6-digit code')).toHaveCount(0);
  await page.getByRole('group', { name: 'Freeze this price' }).getByRole('button', { name: /^Freeze until / }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 1 })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Release it' }).click();
  await page.getByRole('button', { name: 'Keep holding it' }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Release it' }).click();
  await page.getByRole('button', { name: 'Yes, release it' }).click();
  await expect(page.getByRole('heading', { name: 'Released', level: 1 })).toBeVisible({ timeout: 60_000 });
  const released = page.getByRole('region', { name: 'Booking' });
  await expect(released).toContainText('Released by you');
  await expect(released.locator('dt', { hasText: 'Paid' }).locator('+ dd')).toHaveText('Nothing');
  await page.screenshot({ path: 'test-results/23-released.png' });

  // Released means gone: the page cannot be paid or released again.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Released', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm and pay/ })).toHaveCount(0);

  expect(errors).toEqual([]);
});

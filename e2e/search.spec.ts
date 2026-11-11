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
  // No place and dates yet: no hotels panel, and no trip in the list on the left.
  await expect(page.getByRole('region', { name: 'Hotels' })).toHaveCount(0);
  const trips = page.getByRole('navigation', { name: 'Your trips' });
  await expect(trips.getByText('A search appears here once it has a place and dates.')).toBeVisible();

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
  await expect(page.getByLabel('Bringing a pet')).not.toBeChecked();
  await page.getByRole('button', { name: 'That is everyone' }).click();
  // The search has a place and dates now, so it is a trip.
  await expect(trips.getByRole('button', { name: /Porto, Portugal/ })).toHaveAttribute('aria-current', 'true');

  await page.getByRole('button', { name: 'Spain' }).click();
  await page.getByRole('button', { name: 'Lowest price' }).click();

  // The first search: a line saying what was found, and cards on the right.
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 60_000 });
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('Cheapest available');
  await expect(cards.first()).toContainText(/€\d/);
  await expect(cards.first()).toContainText(/total for 2 nights/);
  await expect(cards.nth(1)).toContainText('Than the first:');
  await expect(page.getByRole('region', { name: 'Hotels' }).getByRole('heading', { name: 'Porto, Portugal' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hotels' }).getByText('Lowest price first')).toBeVisible();
  await page.screenshot({ path: 'test-results/01-shortlist.png' });

  // Prices on the cards are in ascending order: the ranking the user asked for.
  const totals = await cards.locator('p').filter({ hasText: /^€[\d,.]+$/ }).allTextContents();
  const numbers = totals.map((t) => Number(t.replace(/[€,]/g, '')));
  expect(numbers).toHaveLength(5);
  expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);

  // The hotels panel is resizable: drag its edge left and it grows; the width survives a reload (checked below).
  const panel = page.getByRole('region', { name: 'Hotels' });
  const handle = page.getByRole('separator', { name: 'Resize the hotels panel' });
  const before = (await panel.boundingBox())!.width;
  const edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + 3, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x - 157, edge.y + 200, { steps: 4 });
  await page.mouse.up();
  const widened = (await panel.boundingBox())!.width;
  expect(Math.round(widened - before)).toBe(160);
  // It cannot squeeze the chat below a usable width, however far it is dragged.
  await handle.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  expect((await page.getByRole('region', { name: 'Conversation' }).boundingBox())!.width).toBeGreaterThanOrEqual(360);
  // A smaller window takes the room from the panel, never from the chat.
  await page.setViewportSize({ width: 1000, height: 860 });
  expect((await page.getByRole('region', { name: 'Conversation' }).boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await page.screenshot({ path: 'test-results/01b-1000-wide.png' });
  await page.setViewportSize({ width: 1360, height: 860 });
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  expect((await panel.boundingBox())!.width).toBe(340);
  await handle.dblclick();
  expect((await panel.boundingBox())!.width).toBe(520);

  // The trips list folds away and the chat takes its room.
  const chatWidth = async () => (await page.getByRole('region', { name: 'Conversation' }).boundingBox())!.width;
  const withList = await chatWidth();
  await page.getByRole('button', { name: 'Trips list' }).click();
  await expect(trips).toBeHidden();
  expect(await chatWidth()).toBe(withList + 260);
  await page.getByRole('button', { name: 'Trips list' }).click();
  await expect(trips).toBeVisible();

  // A typed message. Jev is off here, so it goes to the agent, which caps the price if it can be reached.
  await page.getByLabel('Message').fill('under 120 a night');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('under 120 a night')).toBeVisible();
  await expect(page.getByText(/Capped at €120 a night\. \d+ of \d+ hotels fit\.|The assistant did not answer|The assistant is set up wrongly|ANTHROPIC_API_KEY is not set/)).toBeVisible();

  // The detail sheet.
  await cards.first().getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Facilities' })).toBeVisible({ timeout: 60_000 });
  await expect(sheet.locator('img').first()).toBeVisible();
  // The photo strip keeps its height. It once collapsed to a few pixels in a
  // tall sheet: the images kept their size and the strip clipped them, so the
  // strip itself is what is measured.
  expect((await sheet.locator('img').first().locator('..').boundingBox())!.height).toBeGreaterThan(150);
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
  await expect(page.getByRole('region', { name: 'Hotels' })).toHaveCount(0);
  await expect(page.getByLabel('Destination')).toBeVisible();

  // The trip is still in the list, and opening it brings the search back.
  await trips.getByRole('button', { name: /Porto, Portugal/ }).click();
  await expect(cards).toHaveCount(5);

  // Narrow window: one column, the chat and the hotels take turns, the trips list is a drawer.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(trips).toBeHidden();
  await expect(page.getByRole('separator')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Message')).toBeVisible();
  await expect(cards.first()).toBeHidden();
  await page.getByRole('tab', { name: 'Hotels (5)' }).click();
  await expect(cards.first()).toBeVisible();
  expect((await cards.first().boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); // nothing spills sideways
  await page.screenshot({ path: 'test-results/03-narrow-hotels.png' });
  await page.getByRole('button', { name: 'Trips list' }).click();
  await expect(trips.getByRole('button', { name: /Porto, Portugal/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/04-narrow-drawer.png' });
  await page.getByRole('button', { name: 'Close the trips list' }).click({ position: { x: 370, y: 400 } });
  await expect(trips).toBeHidden();

  expect(errors).toEqual([]);
});

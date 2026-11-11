import { expect, test } from '@playwright/test';

/**
 * The whole first experience, through the real UI: the trip box and its pills, a
 * shortlist of real sandbox hotels with a reason and a price each, a typed
 * message, the detail sheet, and a reload that brings the search back.
 */
test('search for a hotel in Porto', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  // The first screen: one box for the trip, three pills, optional priorities.
  await expect(page.getByRole('heading', { name: 'Not 400 hotels. The right one, and why.' })).toBeVisible();
  // No search yet: no hotels panel, and no trip in the list on the left.
  await expect(page.getByRole('region', { name: 'Hotels' })).toHaveCount(0);
  const trips = page.getByRole('navigation', { name: 'Your trips' });
  await expect(trips.getByText('A search appears here once it has a place and dates.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'When: Tonight · 1 night' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Who: 2 adults' })).toBeVisible();
  // The example answer is a real recorded search ranked by the real ranking.
  const example = page.getByRole('region', { name: 'Example answer' });
  await expect(example).toContainText('Example from a real search: Porto, 2 nights, low price and great reviews');
  await expect(example.getByRole('heading', { level: 3 })).toContainText('Mercure Porto Centro Aliados');
  await expect(example).toContainText('€158.55');
  await page.screenshot({ path: 'test-results/00-first-screen.png' });

  // A whole sentence: searched as typed on Enter, or just its place, and the chips say the sentence is read.
  await page.getByLabel('Your trip', { exact: true }).fill('Porto with my wife, 3 nights in March');
  await expect(page.getByRole('button', { name: /Search for: “Porto with my wife, 3 nights in March”/ })).toBeVisible();
  await expect(page.getByText('Or just the place')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Porto\s*Portugal · City$/ })).toBeVisible();
  await expect(page.getByText('Your sentence already says what matters: we read it when you press Enter.')).toBeVisible();
  await page.screenshot({ path: 'test-results/00a-sentence.png' });

  // A bare place in the box: suggestions with where and what each one is; a hotel is never one.
  await page.getByLabel('Your trip', { exact: true }).fill('porto');
  const porto = page.getByRole('button', { name: /^Porto\s*Portugal · City$/ });
  await expect(porto).toBeVisible();
  await page.screenshot({ path: 'test-results/00b-suggestions.png' });
  await porto.click();
  await expect(page.getByRole('button', { name: /^Where: Porto, Portugal/ })).toBeVisible();

  // Nights: next weekend, through the When pill.
  await page.getByRole('button', { name: /^When:/ }).click();
  const nightsCard = page.getByRole('dialog', { name: 'Choose your nights' });
  await expect(nightsCard.getByRole('grid')).toHaveCount(2);
  await expect(nightsCard).toContainText(/\w{3} \d+ \w{3} – \w{3} \d+ \w{3} · 1 night/);
  await page.getByRole('button', { name: 'Next weekend' }).click();
  await expect(page.getByRole('button', { name: 'Next weekend' })).toHaveAttribute('aria-pressed', 'true');
  await expect(nightsCard).toContainText(/Fri .* – Sun .* · 2 nights/);
  await page.screenshot({ path: 'test-results/00c-when.png' });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^When: .* · 2 nights$/ })).toBeVisible();

  // Who: add an adult and take it away again; no pet.
  await page.getByRole('button', { name: /^Who:/ }).click();
  await page.getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'Fewer adults' }).click();
  await expect(page.getByLabel('Bringing a pet')).not.toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Low price' }).click();
  await expect(page.getByRole('button', { name: 'Low price' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Find my hotel' }).click();

  // The first search: a line saying what was found, and cards on the right.
  await expect(page.getByText(/\d+ of \d+ hotels fit\. The best \d are listed/)).toBeVisible({ timeout: 60_000 });
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('Cheapest available');
  await expect(cards.first()).toContainText(/€\d/);
  await expect(cards.first()).toContainText(/total for 2 nights/);
  // One bubble for the pills, and nothing echoed back: the pills already said it.
  const convo = page.getByRole('region', { name: 'Conversation' });
  await expect(convo.getByText('Porto, Portugal · 2 adults', { exact: true })).toHaveCount(1);
  // The only bare "Porto, Portugal" there is the chat's own heading, not an echoed bubble.
  await expect(convo.getByText('Porto, Portugal', { exact: true })).toHaveCount(1);
  await expect(convo.getByRole('heading', { name: 'Porto, Portugal' })).toBeVisible();
  await expect(convo.getByText(/From your message/)).toHaveCount(0);
  // The search has a place and dates, so it is a trip.
  await expect(trips.getByRole('button', { name: /Porto, Portugal/ })).toHaveAttribute('aria-current', 'true');
  await expect(cards.nth(1)).toContainText('Than the first:');
  await expect(page.getByRole('region', { name: 'Hotels' }).getByRole('heading', { name: 'Porto, Portugal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change what matters most' })).toHaveText('Low price ✎');
  // Never asked, always shown and changeable: the nationality the rates are for.
  await expect(page.getByLabel('Nationality for rates')).toBeVisible();
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
  // A cap keeps only the hotels under it: how many depends on today's sandbox prices.
  let shown = await cards.count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(5);

  // The detail sheet.
  await cards.first().getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Facilities' })).toBeVisible({ timeout: 60_000 });
  await expect(sheet.locator('img').first()).toBeVisible();
  // The photo strip keeps its height. It once collapsed to a few pixels in a
  // tall sheet: the images kept their size and the strip clipped them, so the
  // strip itself is what is measured.
  expect((await sheet.locator('img').first().locator('..').boundingBox())!.height).toBeGreaterThan(150);
  // Book is in the sheet too, with the price it will re-check (the booking itself is e2e/book.spec.ts).
  await expect(sheet.getByRole('button', { name: /^Book · €[\d,.]+$/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/02-detail.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Reload: the search is still there.
  await page.reload();
  await expect(cards).toHaveCount(shown);
  await expect(page.getByText('under 120 a night')).toBeVisible();

  // The header chips change the search in place: one more adult, and the search runs again.
  await page.getByRole('button', { name: 'Change who' }).click();
  await page.getByRole('dialog', { name: 'Change who' }).getByRole('button', { name: 'More adults' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Change who' })).toHaveText(/3 adults/, { timeout: 60_000 });
  // The chat says what changed and what it did, as for a typed change.
  await expect(convo.getByText(/3 adults.*hotels? fits?|3 adults.*No hotel|3 adults/).last()).toBeVisible();
  await page.screenshot({ path: 'test-results/01c-chip-edit.png' });
  // And back again.
  await page.getByRole('button', { name: 'Change who' }).click();
  await page.getByRole('dialog', { name: 'Change who' }).getByRole('button', { name: 'Fewer adults' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Change who' })).toHaveText(/2 adults/, { timeout: 60_000 });
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  shown = await cards.count();

  // New search starts clean.
  await page.getByRole('button', { name: 'New search' }).click();
  await expect(page.getByRole('region', { name: 'Hotels' })).toHaveCount(0);
  await expect(page.getByLabel('Your trip', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your trip', { exact: true })).toHaveValue('');

  // The trip is still in the list, and opening it brings the search back.
  await trips.getByRole('button', { name: /Porto, Portugal/ }).click();
  await expect(cards).toHaveCount(shown);

  // Narrow window: one column, the chat and the hotels take turns, the trips list is a drawer.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(trips).toBeHidden();
  await expect(page.getByRole('separator')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Message')).toBeVisible();
  await expect(cards.first()).toBeHidden();
  await page.getByRole('tab', { name: `Hotels (${shown})` }).click();
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

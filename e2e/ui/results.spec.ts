import { expect, openSession, test } from '../fixtures/test';
import { Calendar } from '../pages/app';
import { json } from '../support/api';
import { COPY } from '../support/copy';
import { addDays, nightsBetween } from '../support/dates';
import { MONEY, minor } from '../support/money';
import * as S from '../support/schemas';

/**
 * The shortlist (docs/architecture.md §13, docs/entry-ux.md §2.3): the cards,
 * the results header's chips that change the search in place, the trips list,
 * the resizable chat and the narrow layout. Supplier data is live sandbox
 * data: names and prices are checked for their format and invariants, never
 * for fixed values.
 */
const CANCELLATION = /^(Non-refundable|Refundable; see the hotel for the deadline|Free cancellation until \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} UTC)( · .+)?$/;
const RATING_LINE = /^(\d{1,2}(\.\d)? )?(\(\d{1,3}(,\d{3})* reviews?\) )?(· \d(\.\d)?★ ?)?(· (\d+ m|\d+\.\d km))?$/;

test.describe('results', { tag: '@ui' }, () => {
  test('every card has a rank, a reason, the total, the price a night and its terms', { tag: '@content' }, async ({ page, app, searched, api }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const view = searched.view;
    const nights = nightsBetween(view.stay!.checkIn, view.stay!.checkOut);
    const cards = app.results.cards();
    await expect(cards).toHaveCount(view.shortlist.length);
    expect(view.shortlist.length).toBeGreaterThanOrEqual(1);
    expect(view.shortlist.length).toBeLessThanOrEqual(5);
    // An anonymous visitor sees public prices only, and is told so (architecture §14.7).
    expect(view.session.audience).toBe('public');
    await expect(app.results.publicNote()).toHaveText(COPY.publicPrices);

    for (let i = 0; i < view.shortlist.length; i++) {
      const row = view.shortlist[i];
      const card = app.results.card(i);
      expect(row.offer?.audience ?? 'public').toBe('public');
      expect(await card.rank()).toBe(row.source === 'finder' ? String(i + 1) : '•');
      expect(await card.name()).toBe(row.property.name);
      const lines = card.root.locator('h3 ~ p');
      await expect(lines.nth(0)).toHaveText(RATING_LINE);
      // The reason it is on the list: always said, never blank.
      await expect(lines.nth(1)).toHaveText(/\S{3,}/);
      if (i > 0 && (row.reason as { kind?: string } | null)?.kind === 'runner_up') await expect(lines.nth(1)).toHaveText(/^Than the first: /);
      if (!row.offer) continue;
      await expect(lines.nth(2)).toHaveText(CANCELLATION);
      const total = (await card.total().textContent())!.trim();
      expect(total).toMatch(MONEY);
      expect(minor(total)).toBe(row.offer.totalMinor);
      // The total for the stay first; the price a night is that total over the nights, rounded up to the cent.
      const perNight = (await card.perNightLine().textContent())!.trim();
      expect(perNight).toMatch(new RegExp(`^total for ${nights} nights? · (.+) a night$`));
      const perNightMinor = minor(perNight.replace(/^total for \d+ nights? · /, '').replace(/ a night$/, ''));
      expect(perNightMinor).toBe(Math.ceil(row.offer.totalMinor / nights));
      const atHotel = card.root.getByText(/^\+ .+ paid at the hotel$/);
      if (row.offer.payAtPropertyMinor > 0) expect(minor((await atHotel.textContent())!.replace(/^\+ /, '').replace(/ paid at the hotel$/, ''))).toBe(row.offer.payAtPropertyMinor);
      else await expect(atHotel).toHaveCount(0);
      await expect(card.book()).toHaveText('Book');
      await expect(card.details()).toHaveText('Details');
      await expect(card.details()).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(page).toHaveLoadedImages();
    await expect(page).toHaveWorkingLinks(api.request);
  });

  test('ranked for low price, the cards go cheapest first', async ({ page, app, visitor }) => {
    const { sessionId } = await visitor.api().search({ priorities: ['cheapest'] });
    await visitor.toBrowser();
    await openSession(page, sessionId);
    await app.results.waitForCards();
    await expect(app.results.priorities()).toHaveText('Low price ✎');
    await expect(app.results.card(0).root).toContainText('Cheapest available');
    const totals = [];
    for (let i = 0; i < (await app.results.cards().count()); i++) totals.push(await app.results.card(i).totalMinor());
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  test('the header names the search; each chip says what it is set to', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const stay = searched.view.stay!;
    await expect(app.results.heading()).toHaveText('Porto, Portugal');
    await expect(app.chat.heading()).toHaveText('Porto, Portugal');
    await expect(app.results.changeWhere()).toHaveText('Porto, Portugal ✎');
    const fmt = (d: string, month: boolean) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
    const sameMonth = stay.checkIn.slice(0, 7) === stay.checkOut.slice(0, 7);
    await expect(app.results.changeWhen()).toHaveText(`${fmt(stay.checkIn, !sameMonth)}–${fmt(stay.checkOut, true)}, 2 nights ✎`);
    await expect(app.results.changeWho()).toHaveText('2 adults ✎');
    await expect(app.results.priorities()).toHaveText('Balanced ✎');
    for (const chip of [app.results.changeWhere(), app.results.changeWhen(), app.results.changeWho()]) await expect(chip).toHaveAttribute('aria-expanded', 'false');
    // Never asked, always shown and changeable: the nationality the rates are for.
    await expect(app.results.nationality()).toHaveValue(searched.view.session.guestNationality!);
    await expect(app.results.mapToggle()).toHaveText('Hide map');
    await expect(app.results.mapToggle()).toHaveAttribute('aria-pressed', 'true');
  });

  test('the nationality list reads in alphabetical order', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const names = await app.results.nationality().locator('option').allTextContents();
    expect(names.length).toBeGreaterThan(200);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names.slice(0, 8), 'a person looks for their country by its name').toEqual(sorted.slice(0, 8));
  });

  test('Change who: one more adult searches again; the pet becomes a requirement', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const editor = app.results.editor('who');
    await app.results.changeWho().click();
    await expect(app.results.changeWho()).toHaveAttribute('aria-expanded', 'true');
    await editor.getByRole('button', { name: 'More adults' }).click();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(editor).toHaveCount(0);
    await expect(app.results.changeWho()).toHaveText('3 adults ✎', { timeout: 90_000 });
    // The chat says what changed, as for a typed change.
    await expect(app.chat.region().getByText(/^3 adults\./).last()).toBeVisible();
    await app.results.waitForCards();

    // The pet is a requirement on the hotel: it shows as one.
    await app.results.changeWho().click();
    await editor.getByRole('button', { name: 'Fewer adults' }).click();
    await editor.getByLabel('Bringing a pet').check();
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.changeWho()).toHaveText('2 adults · pet ✎', { timeout: 90_000 });
    await expect(app.results.region().getByText('pets allowed', { exact: true })).toBeVisible();
    await expect(app.chat.region().getByText(/Must have pets allowed\./).last()).toBeVisible();
  });

  for (const how of ['Cancel', 'Escape'] as const) {
    test(`Change who: ${how} closes the editor, sends nothing, and the edit is forgotten`, async ({ page, app, searched }) => {
      await openSession(page, searched.sessionId);
      await app.results.waitForCards();
      const editor = app.results.editor('who');
      let edits = 0;
      page.on('request', (r) => r.url().includes('/edit') && edits++);
      await app.results.changeWho().click();
      await editor.getByRole('button', { name: 'More adults' }).click();
      await editor.getByLabel('Bringing a pet').check();
      if (how === 'Cancel') await editor.getByRole('button', { name: 'Cancel' }).click();
      else {
        await editor.getByRole('button', { name: 'More adults' }).focus();
        await page.keyboard.press('Escape');
        await expect(app.results.changeWho()).toBeFocused();
      }
      await expect(editor).toHaveCount(0);
      await expect(app.results.changeWho()).toHaveText('2 adults ✎');
      expect(edits).toBe(0);
      // Opened again, the editor shows the search as it is, not the discarded edit.
      await app.results.changeWho().click();
      await expect(editor.getByRole('button', { name: 'More adults' }).locator('xpath=..').locator('output')).toHaveText('2');
      await expect(editor.getByLabel('Bringing a pet')).not.toBeChecked();
    });

    test(`Change when: ${how} closes the calendar, and the nights picked are forgotten`, async ({ page, app, searched }) => {
      await openSession(page, searched.sessionId);
      await app.results.waitForCards();
      const editor = app.results.editor('when');
      const stay = searched.view.stay!;
      const label = (await app.results.changeWhen().textContent())!.replace(/ ✎$/, '');
      await app.results.changeWhen().click();
      await new Calendar(editor).pick(addDays(stay.checkIn, 7), addDays(stay.checkIn, 10));
      await expect(editor).toContainText(', 3 nights');
      if (how === 'Cancel') await editor.getByRole('button', { name: 'Cancel' }).click();
      else {
        await editor.getByRole('button', { name: 'Next month' }).focus();
        await page.keyboard.press('Escape');
        await expect(app.results.changeWhen()).toBeFocused();
      }
      await expect(editor).toHaveCount(0);
      await expect(app.results.changeWhen()).toHaveText(`${label} ✎`);
      await app.results.changeWhen().click();
      await expect(editor.locator('span').filter({ hasText: /nights?$/ }).last()).toHaveText(label);
    });
  }

  test('Change where: Escape closes it and hands focus back to the chip', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.results.changeWhere().click();
    await expect(app.results.editor('where').getByLabel('New place')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(app.results.editor('where')).toHaveCount(0);
    await expect(app.results.changeWhere()).toBeFocused();
  });

  for (const how of ['Cancel', 'Escape'] as const) {
    test(`What matters: ${how} closes the toggles without changing the ranking`, async ({ page, app, searched }) => {
      await openSession(page, searched.sessionId);
      await app.results.waitForCards();
      let edits = 0;
      page.on('request', (r) => r.url().includes('/edit') && edits++);
      await app.results.priorities().click();
      const group = app.results.prioritiesGroup();
      await group.getByRole('button', { name: 'Low price' }).click();
      if (how === 'Cancel') await group.getByRole('button', { name: 'Cancel' }).click();
      else await page.keyboard.press('Escape');
      await expect(group).toHaveCount(0);
      await expect(app.results.priorities()).toHaveText('Balanced ✎');
      expect(edits).toBe(0);
      await app.results.priorities().click();
      await expect(group.getByRole('button', { name: 'Low price' })).toHaveAttribute('aria-pressed', 'false');
    });
  }

  test('Change who: children with ages and rooms, as in the Who pill', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const editor = app.results.editor('who');
    await app.results.changeWho().click();
    await expect(editor.getByRole('button', { name: 'Fewer children' })).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'More rooms' })).toBeEnabled();
    await editor.getByRole('button', { name: 'More children' }).click();
    await expect(editor.getByLabel('Age of child 1')).toHaveValue('8');
    await editor.getByLabel('Age of child 1').selectOption('5');
    await editor.getByRole('button', { name: 'More rooms' }).click();
    await expect(editor.getByRole('button', { name: 'More rooms' })).toBeDisabled();
    await editor.getByRole('button', { name: 'Fewer rooms' }).click();
    await editor.getByRole('button', { name: 'Fewer children' }).click();
    await expect(editor.getByLabel('Age of child 1')).toHaveCount(0);
    // Back where it started: Apply sends nothing, there is nothing to change.
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.changeWho()).toHaveText('2 adults ✎');
  });

  test('Change when: new nights search again', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const editor = app.results.editor('when');
    const stay = searched.view.stay!;
    const checkIn = addDays(stay.checkIn, 7);
    const checkOut = addDays(checkIn, 3);
    await app.results.changeWhen().click();
    await expect(editor.getByRole('grid')).toHaveCount(2);
    await new Calendar(editor).pick(checkIn, checkOut);
    await expect(editor).toContainText(', 3 nights');
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.changeWhen()).toHaveText(/, 3 nights ✎$/, { timeout: 90_000 });
    await app.results.waitForCards();
    await expect(app.results.card(0).perNightLine()).toHaveText(/^total for 3 nights · /);
    await expect(app.chat.region().getByText(/, 3 nights\./).last()).toBeVisible();
  });

  test('Change where: a new place searches there, and the trip follows', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const editor = app.results.editor('where');
    await app.results.changeWhere().click();
    await expect(editor.getByLabel('New place')).toBeFocused();
    // The Where editor applies on a pick; pressing the chip again closes it.
    await app.results.changeWhere().click();
    await expect(editor).toHaveCount(0);
    await app.results.changeWhere().click();
    await editor.getByLabel('New place').fill('lisbon');
    await editor.getByRole('button', { name: /^Lisbon\s*Portugal · City$/ }).click();
    await expect(app.results.heading()).toHaveText('Lisbon, Portugal', { timeout: 90_000 });
    await expect(app.chat.region().getByText('Searching Lisbon, Portugal.').last()).toBeVisible();
    await app.results.waitForCards();
    await expect(app.sidebar.trip(/Lisbon, Portugal/)).toHaveAttribute('aria-current', 'true');
  });

  test('What matters: three toggles and Apply, and the chat says how it is ranked', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.results.priorities().click();
    const group = app.results.prioritiesGroup();
    await expect(group.getByRole('button', { name: 'Low price' })).toHaveAttribute('aria-pressed', 'false');
    await expect(group.getByRole('button', { name: 'Great reviews' })).toHaveAttribute('aria-pressed', 'false');
    await expect(group.getByRole('button', { name: 'Close to central Porto' })).toHaveAttribute('aria-pressed', 'false');
    await group.getByRole('button', { name: 'Great reviews' }).click();
    await group.getByRole('button', { name: 'Close to central Porto' }).click();
    await group.getByRole('button', { name: 'Close to central Porto' }).click();
    await expect(group.getByRole('button', { name: 'Great reviews' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.priorities()).toHaveText('Great reviews ✎', { timeout: 90_000 });
    await expect(app.chat.region().getByText('Ranked for great reviews.').last()).toBeVisible();
    await app.results.waitForCards();
  });

  test('Nationality for rates: another country prices the search again', async ({ page, app, searched, visitor }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const edit = page.waitForResponse((r) => r.url().includes('/edit'));
    await app.results.nationality().selectOption({ label: 'Spain' });
    expect((await edit).status()).toBe(200);
    await expect(app.results.nationality()).toHaveValue('ES');
    await app.results.waitForCards();
    await visitor.fromBrowser();
    const view = await json(await visitor.api().session(searched.sessionId), S.sessionView);
    expect(view.session.guestNationality).toBe('ES');
    expect(view.session.nationalitySource).toBe('user');
  });

  test('Penny names one hotel and her button opens it', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    const pick = searched.view.messages.find((m) => (m.meta as { pennyPick?: unknown } | null)?.pennyPick);
    if (!pick) {
      // Penny names a hotel only when many fit (sandbox data decides): then there is no button either.
      await expect(app.chat.region().getByRole('button', { name: /^Open / })).toHaveCount(0);
      return;
    }
    const name = searched.view.shortlist.find((r) => r.property.id === (pick!.meta as { pennyPick: { propertyId: string } }).pennyPick.propertyId)!.property.name;
    await expect(app.chat.region().getByText(new RegExp(`I like ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, rated [\\d.]+`))).toBeVisible();
    await app.chat.region().getByRole('button', { name: `Open ${name}` }).click();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
  });

  test('a reload brings the search back as it was', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const names = await app.results.cards().getByRole('heading', { level: 3 }).allTextContents();
    await page.reload();
    await app.results.waitForCards();
    expect(await app.results.cards().getByRole('heading', { level: 3 }).allTextContents()).toEqual(names);
    await expect(app.chat.heading()).toHaveText('Porto, Portugal');
  });

  test('New search starts clean, and the trip reopens from the list', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const count = await app.results.cards().count();
    await app.sidebar.newSearch().click();
    await expect(app.results.region()).toHaveCount(0);
    await expect(app.trip.box()).toHaveValue('');
    await expect(app.trip.where()).toHaveText('Where: Add a place');
    await expect(app.trip.when()).toHaveText('When: Tonight · 1 night');
    await expect(app.chat.heading()).toHaveText('New search');
    // The trip stays in the list, and reopens with its shortlist.
    const trip = app.sidebar.trip(/Porto, Portugal/);
    await expect(trip).toBeVisible();
    await expect(trip).not.toHaveAttribute('aria-current', 'true');
    await trip.click();
    await expect(app.results.cards()).toHaveCount(count);
    await expect(trip).toHaveAttribute('aria-current', 'true');
    // Opening the trip already on screen changes nothing.
    await trip.click();
    await expect(app.results.cards()).toHaveCount(count);
    // A reload after New search shows the first screen, not the old search.
    await app.sidebar.newSearch().click();
    await page.reload();
    await expect(app.trip.box()).toBeVisible();
  });

  test('a returning visitor sees their trips on the first screen', async ({ page, app, searched }) => {
    // This browser owns the search (its cookie), but has no search open: a new tab, or after New search and a reload.
    await app.goto();
    await expect(app.trip.box()).toBeVisible();
    await expect(app.sidebar.trip(/Porto, Portugal/), 'GET /api/session lists it').toBeVisible();
    await expect(app.sidebar.nav().getByText(COPY.noTrips)).toHaveCount(0);
    await app.sidebar.trip(/Porto, Portugal/).click();
    await expect(app.results.cards()).toHaveCount(searched.view.shortlist.length);
  });

  test('the trips list folds away, the hotels take its room, and it stays folded over a reload', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const width = async () => (await app.results.region().boundingBox())!.width;
    const withList = await width();
    await app.sidebar.toggle().click();
    await expect(app.sidebar.nav()).toBeHidden();
    await expect(app.sidebar.toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(await width()).toBeGreaterThan(withList + 150);
    await page.reload();
    await app.results.waitForCards();
    await expect(app.sidebar.nav()).toBeHidden();
    await app.sidebar.toggle().click();
    await expect(app.sidebar.nav()).toBeVisible();
    await expect(app.sidebar.toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  test('the chat edge: drag, arrow keys and a double-click to reset; the hotels never squeezed', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const chat = app.chat.region();
    const panel = app.results.region();
    const handle = page.getByRole('separator', { name: 'Resize the chat' });
    expect(Math.round((await chat.boundingBox())!.width)).toBe(Math.round(1360 * 0.3));
    expect((await panel.boundingBox())!.x).toBeLessThan((await chat.boundingBox())!.x);
    const before = (await chat.boundingBox())!.width;
    const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + 3, edge.y + 200);
    await page.mouse.down();
    await page.mouse.move(edge.x - 157, edge.y + 200, { steps: 4 });
    await page.mouse.up();
    expect(Math.round((await chat.boundingBox())!.width - before)).toBe(160);
    await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(before + 160)));
    await handle.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
    expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(480);
    await page.setViewportSize({ width: 1000, height: 860 });
    expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(480);
    await page.setViewportSize({ width: 1360, height: 860 });
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
    expect((await chat.boundingBox())!.width).toBe(320);
    // The width is remembered over a reload…
    await page.reload();
    await app.results.waitForCards();
    expect((await app.chat.region().boundingBox())!.width).toBe(320);
    // …and a double-click puts it back to 30% of the window.
    await page.getByRole('separator', { name: 'Resize the chat' }).dblclick();
    expect(Math.round((await app.chat.region().boundingBox())!.width)).toBe(Math.round(1360 * 0.3));
  });

  test('a narrow window: one column, Chat and Hotels as tabs, the trips list a drawer', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const count = await app.results.cards().count();
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(app.sidebar.nav()).toBeHidden();
    await expect(page.getByRole('separator', { name: 'Resize the chat' })).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await expect(app.chat.input()).toBeVisible();
    await expect(app.results.card(0).root).toBeHidden();
    await page.getByRole('tab', { name: `Hotels (${count})` }).click();
    await expect(page.getByRole('tab', { name: `Hotels (${count})` })).toHaveAttribute('aria-selected', 'true');
    await expect(app.results.card(0).root).toBeVisible();
    expect((await app.results.card(0).root.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(app.chat.input()).toBeVisible();
    // The drawer: opened by the same button, closed by its scrim, or by picking a trip.
    await app.sidebar.toggle().click();
    await expect(app.sidebar.trip(/Porto, Portugal/)).toBeVisible();
    await app.sidebar.scrim().click({ position: { x: 370, y: 400 } });
    await expect(app.sidebar.nav()).toBeHidden();
    await app.sidebar.toggle().click();
    await app.sidebar.trip(/Porto, Portugal/).click();
    await expect(app.sidebar.nav()).toBeHidden();
  });
});

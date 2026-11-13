import { expect, openSession, test } from '../fixtures/test';
import { json } from '../support/api';
import { MONEY } from '../support/money';
import * as S from '../support/schemas';

/**
 * Saved hotels, the heart (docs/saved.md): on every card, beside the name in
 * the detail view, and in the list under "Your trips", where each entry opens
 * the search it was saved from. The price shown is the last one found, never
 * a current one. Anonymous throughout: the signed cookie owns the list.
 */
const LAST_FOUND = /^Last price found: \S+ for \d{1,2}(\s\w{3})?–\d{1,2} \w{3}, \d+ nights?, on \d{1,2} \w{3}$/;

test.describe('saved hotels', { tag: '@ui' }, () => {
  test('the heart on a card saves the hotel; the list shows it with its last price found; its own heart unsaves it', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await expect(app.sidebar.nav().getByRole('heading', { name: 'Saved hotels' })).toBeVisible();
    await expect(app.sidebar.savedEmpty()).toBeVisible();
    const card = app.results.card(0);
    const name = await card.name();
    await expect(card.heart()).toHaveAccessibleName(`Save ${name}`);
    await expect(card.heart()).toHaveAttribute('aria-pressed', 'false');
    await expect(card.heart()).toHaveAttribute('title', /\S/);
    const save = page.waitForRequest((r) => r.url().endsWith('/api/saved') && r.method() === 'POST');
    await card.heart().click();
    expect((await save).postDataJSON()).toEqual({ saved: true, propertyId: searched.view.shortlist[0].property.id, sessionId: searched.sessionId });
    await expect(card.heart()).toHaveAccessibleName(`Remove ${name} from saved hotels`);
    await expect(card.heart()).toHaveAttribute('aria-pressed', 'true');

    const list = app.sidebar.savedList();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(app.sidebar.saved(name)).toContainText(name);
    const line = (await app.sidebar.saved(name).locator('span').last().textContent())!.trim();
    expect(line).toMatch(LAST_FOUND);
    // Said as the last price found: the card's own total, never "now" or "current".
    expect(line).toContain((await card.total().textContent())!.trim());
    expect(line).not.toMatch(/now|current/i);
    await expect(app.sidebar.saved(name)).toHaveAttribute('title', 'Open the search it was saved from');

    // A reload keeps it: the cookie owns the list.
    await page.reload();
    await app.results.waitForCards();
    await expect(app.sidebar.saved(name)).toBeVisible();
    await app.sidebar.savedHeart(name).click();
    await expect(app.sidebar.savedEmpty()).toBeVisible();
    await expect(card.heart()).toHaveAttribute('aria-pressed', 'false');
  });

  test('the heart in the detail view says the same as the card, and saves and unsaves too', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    const card = app.results.card(1);
    const name = await card.name();
    await card.details().click();
    const heart = app.detail.heart();
    await expect(heart).toHaveAccessibleName(`Save ${name}`);
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expect(app.sidebar.saved(name)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.heart()).toHaveAttribute('aria-pressed', 'true');
    await card.details().click();
    await app.detail.heart().click();
    await expect(app.detail.heart()).toHaveAttribute('aria-pressed', 'false');
    await expect(app.sidebar.savedEmpty()).toBeVisible();
  });

  test('a saved hotel opens the search it was saved from', async ({ page, app, searched, api }) => {
    const row = searched.view.shortlist[0];
    await json(await api.save({ saved: true, propertyId: row.property.id, sessionId: searched.sessionId }), S.savedBody);
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.sidebar.newSearch().click();
    await expect(app.trip.box()).toBeVisible();
    // The list is there on the first screen too, and the entry opens its search.
    await app.sidebar.saved(row.property.name).click();
    await app.results.waitForCards();
    await expect(app.results.heading()).toHaveText('Porto, Portugal');
    await expect(app.sidebar.trip(/Porto, Portugal/)).toHaveAttribute('aria-current', 'true');
    await expect(app.results.card(0).heart()).toHaveAttribute('aria-pressed', 'true');
  });

  test('the heart on a card in "Show all" saves that hotel', async ({ page, app, searched }) => {
    expect(searched.view.fullList.more, 'the canonical Porto search has hotels after the top picks').toBeGreaterThan(0);
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.results.showAll().click();
    const card = app.results.fullCard(0);
    await expect(card.root).toBeVisible();
    const name = await card.name();
    await card.heart().click();
    await expect(card.heart()).toHaveAttribute('aria-pressed', 'true');
    await expect(app.sidebar.saved(name)).toBeVisible();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: /\S/ })).toHaveCount(0);
  });
});

test.describe('currency', { tag: '@ui' }, () => {
  test('another currency prices the search again: every card in it, the saved price too, and kept over a reload', async ({ page, app, searched, api }) => {
    const row = searched.view.shortlist[0];
    await json(await api.save({ saved: true, propertyId: row.property.id, sessionId: searched.sessionId }), S.savedBody);
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await expect(app.results.currency()).toHaveText('Prices in EUR ✎');
    await app.results.currency().click();
    const editor = app.results.filterEditor('currency');
    const select = editor.getByLabel('Currency', { exact: true });
    await expect(select).toHaveValue('EUR');
    // The common currencies first, each named; then every other code.
    await expect(select.locator('option').first()).toHaveText(/^[A-Z]{3} · \S/);
    await expect(editor).toContainText('The hotels are searched again and priced in this currency.');
    await select.selectOption('USD');
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.chat.region().getByText(/^Prices in USD\. /).last()).toBeVisible({ timeout: 90_000 });
    await expect(app.results.currency()).toHaveText('Prices in USD ✎');
    await app.results.waitForCards();
    for (let i = 0; i < (await app.results.cards().count()); i++) {
      const total = (await app.results.card(i).total().textContent())!.trim();
      expect(total).toMatch(MONEY);
      expect(total.startsWith('$')).toBe(true);
    }
    await expect(app.results.cards().first()).not.toContainText('€');
    await expect(app.sidebar.savedList()).toContainText(/Last price found: \$[\d,.]+ for /);
    await page.reload();
    await expect(app.results.currency()).toHaveText('Prices in USD ✎');
  });

  test('Cancel and Escape leave the currency as it was, and send nothing', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    let edits = 0;
    page.on('request', (r) => r.url().endsWith('/edit') && edits++);
    for (const how of ['Cancel', 'Escape'] as const) {
      await app.results.currency().click();
      const editor = app.results.filterEditor('currency');
      await editor.getByLabel('Currency', { exact: true }).selectOption('GBP');
      if (how === 'Cancel') await editor.getByRole('button', { name: 'Cancel' }).click();
      else await editor.getByLabel('Currency', { exact: true }).press('Escape');
      await expect(editor).toHaveCount(0);
      await expect(app.results.currency()).toHaveText('Prices in EUR ✎');
    }
    // Apply with the same currency changes nothing either.
    await app.results.currency().click();
    await app.results.filterEditor('currency').getByRole('button', { name: 'Apply' }).click();
    expect(edits).toBe(0);
    await app.results.currency().click();
    await expect(app.results.filterEditor('currency').getByLabel('Currency', { exact: true })).toHaveValue('EUR');
  });
});

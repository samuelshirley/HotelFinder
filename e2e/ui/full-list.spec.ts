import type { Page, Route } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import { SignInModal, type AppPage } from '../pages/app';
import { uniqueEmail } from '../support/env';
import { ERROR_COPY } from '../support/copy';

/**
 * "Show all N hotels" (docs/finder.md, "The full list"): the top picks stay as
 * they are; the control opens every other hotel that fits, in the finder's
 * order, a page at a time, as compact cards that open and book like the
 * others; the map shows the page on screen.
 */
async function open(page: Page, app: AppPage, sessionId: string) {
  await openSession(page, sessionId, '?detail=slideout');
  await app.results.waitForCards();
}

test.describe('the full list', { tag: '@ui' }, () => {
  test.beforeEach(async ({ visitor }, info) => {
    // Ranked for low price, so the order of the tail can be read off its prices.
    const { sessionId, view } = await visitor.api().search({ priorities: ['cheapest'] });
    expect(view.fullList.more, 'the Porto search has hotels after the top picks').toBeGreaterThan(0);
    await visitor.toBrowser();
    info.annotations.push({ type: 'session', description: JSON.stringify({ sessionId, total: view.fullList.total, more: view.fullList.more, picks: view.shortlist.length }) });
  });
  const session = () => JSON.parse(test.info().annotations.find((a) => a.type === 'session')!.description!) as { sessionId: string; total: number; more: number; picks: number };

  test('Show all opens every other hotel that fits, in the same order, compact; Top picks only folds it', async ({ page, app }) => {
    const s = session();
    await open(page, app, s.sessionId);
    await expect(app.results.showAll()).toHaveText(`Show all ${s.total} hotels`);
    await app.results.showAll().click();
    const list = app.results.fullList();
    await expect(list.getByRole('heading', { name: `All ${s.total} hotels that fit` })).toBeVisible();
    const onPage = Math.min(s.more, 20);
    await expect(app.results.fullCards()).toHaveCount(onPage);
    await expect(list).toContainText(`Hotels ${s.picks + 1}–${s.picks + onPage} of ${s.total}, in the same order as the picks above.`);
    // The picks keep their place and their reasons.
    await expect(app.results.cards()).toHaveCount(s.picks);
    await expect(app.results.card(0).root).toContainText('Cheapest available');
    let previous = await app.results.card(s.picks - 1).totalMinor();
    for (let i = 0; i < onPage; i++) {
      const card = app.results.fullCard(i);
      expect(await card.rank()).toBe(String(s.picks + 1 + i));
      await expect(card.root).toHaveAttribute('data-compact', 'true');
      await expect(card.root.locator('img')).toHaveCount(0);
      const total = await card.totalMinor();
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
    await app.results.topPicksOnly().click();
    await expect(app.results.fullCards()).toHaveCount(0);
    await expect(app.results.showAll()).toBeVisible();
    await expect(app.results.cards()).toHaveCount(s.picks);
  });

  test('the map shows the picks and the page on screen, and frames that page', async ({ page, app }) => {
    const s = session();
    await open(page, app, s.sessionId);
    const map = app.results.map();
    await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(app.results.pins()).toHaveCount(s.picks);
    await expect(map).toHaveAttribute('data-frame', 'all');
    await app.results.showAll().click();
    const onPage = Math.min(s.more, 20);
    await expect(app.results.pins()).toHaveCount(s.picks + onPage);
    await expect(map).toHaveAttribute('data-frame', 'page');
    await expect(map.locator('button[data-pin]', { hasText: new RegExp(`^${s.picks + 1}( · |$)`) })).toHaveCount(1);
    const band = (await map.boundingBox())!;
    const ids = await app.results.fullCards().evaluateAll((els) => els.map((el) => el.id.replace(/^hotel-/, '')));
    const outside = () =>
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
        { ids, b: band },
      );
    await expect.poll(outside, { timeout: 10_000 }).toBe(0);
    await app.results.topPicksOnly().click();
    await expect(app.results.pins()).toHaveCount(s.picks);
    await expect(map).toHaveAttribute('data-frame', 'all');
  });

  test('a hotel from the full list opens in the detail view and books like a top pick', async ({ page, app }) => {
    const s = session();
    await open(page, app, s.sessionId);
    await app.results.showAll().click();
    const card = app.results.fullCard(0);
    const name = await card.name();
    await card.details().click();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await expect(app.detail.price()).toBeVisible();
    await expect(page.getByText(ERROR_COPY.property_not_found)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await card.book().click();
    // Signed out, Book asks who is booking first.
    await new SignInModal(page, 'Sign in to book').signIn(uniqueEmail('full-list'));
    await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const stay = page.getByRole('region', { name: 'Your stay' });
    await expect(stay.getByRole('heading', { name })).toBeVisible();
    await expect(stay).toContainText(/Price re-checked with the hotel just now|The price changed: it was/);
  });

  test('the pager: Next and Previous move a page and say where you are', async ({ page, app }) => {
    const s = session();
    // Thirty hotels are asked for, so the real list is one page: a longer one is shown by answering with
    // more rows than fit a page (the session's count and page 2 are the real rows, renumbered).
    const more = 45;
    await page.route(new RegExp(`/api/session/${s.sessionId}$`), async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, fullList: { ...body.fullList, total: body.fullList.total - body.fullList.more + more, more } } });
    });
    await page.route(new RegExp(`/api/session/${s.sessionId}/hotels\\?page=\\d+$`), async (route: Route) => {
      const asked = Number(new URL(route.request().url()).searchParams.get('page'));
      const res = await route.fetch({ url: route.request().url().replace(/page=\d+$/, 'page=1') });
      const body = await res.json();
      const rows = body.rows.map((r: { rank: number }, i: number) => ({ ...r, rank: s.picks + 1 + (asked - 1) * 20 + i }));
      await route.fulfill({ response: res, json: { ...body, more, page: asked, rows } });
    });
    await open(page, app, s.sessionId);
    await app.results.showAll().click();
    const pager = app.results.pager();
    await expect(pager).toContainText('Page 1 of 3');
    await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText('Page 2 of 3');
    await expect(app.results.fullList()).toContainText(`Hotels ${s.picks + 21}–${s.picks + 40} of`);
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText('Page 3 of 3');
    await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Previous' }).click();
    await expect(pager).toContainText('Page 2 of 3');
  });

  test('a page that does not load says so, and Try again loads it', async ({ page, app, diagnostics }) => {
    const s = session();
    diagnostics.allow(/\/hotels\?page=\d+$/, 503, 'the page is made to fail once');
    let fail = true;
    await page.route(/\/api\/session\/[^/]+\/hotels\?page=\d+$/, (route) => (fail ? route.fulfill({ status: 503, json: { error: 'supplier_unavailable' } }) : route.fallback()));
    await open(page, app, s.sessionId);
    await app.results.showAll().click();
    const alert = app.results.fullList().getByRole('alert');
    await expect(alert).toContainText(ERROR_COPY.supplier_unavailable);
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(app.results.fullCards()).toHaveCount(Math.min(s.more, 20));
    await expect(alert).toHaveCount(0);
  });

  test('a change that searches again (the currency) keeps your place in the full list', async ({ page, app }) => {
    // 2026-11-14: scrolled down the full list, a new currency brought the list back at about hotel 10.
    const s = session();
    await open(page, app, s.sessionId);
    await app.results.showAll().click();
    const onPage = Math.min(s.more, 20);
    await expect(app.results.fullCards()).toHaveCount(onPage);
    const id = (await app.results.fullCard(Math.min(onPage - 3, 12)).root.getAttribute('id'))!;
    /** The list's own scroller, and where the hotel sits in it. */
    const place = () =>
      page.evaluate((id) => {
        let view = document.getElementById('full-list')!.parentElement;
        while (view && !/(auto|scroll)/.test(getComputedStyle(view).overflowY)) view = view.parentElement;
        const card = document.getElementById(id);
        return { scrollTop: Math.round(view!.scrollTop), offset: card ? Math.round(card.getBoundingClientRect().top - view!.getBoundingClientRect().top) : null };
      }, id);
    // A browser without scroll anchoring (Safari), so the place is the app's to keep, not Chromium's to repair.
    await page.evaluate(() => {
      let view = document.getElementById('full-list')!.parentElement;
      while (view && !/(auto|scroll)/.test(getComputedStyle(view).overflowY)) view = view.parentElement;
      view!.style.overflowAnchor = 'none';
    });
    await page.evaluate((id) => document.getElementById(id)!.scrollIntoView({ block: 'start' }), id);
    const before = await place();
    expect(before.scrollTop, 'the list is scrolled well down the full list').toBeGreaterThan(1000);

    await app.results.currency().click();
    const editor = app.results.filterEditor('currency');
    await editor.getByLabel('Currency', { exact: true }).selectOption('GBP');
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(app.results.currency()).toHaveText('Prices in GBP ✎', { timeout: 90_000 });
    await expect(app.results.fullCard(0).total()).toContainText('£', { timeout: 60_000 });
    await expect(app.results.fullList()).not.toHaveAttribute('aria-busy', 'true');
    // The same hotel, while the new ranking's page still holds it, sits where it was; else the list stays where it was.
    if ((await place()).offset !== null) await expect.poll(async () => Math.abs((await place()).offset! - before.offset!)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await place()).scrollTop).toBe(before.scrollTop);
  });

  test('Penny opens it when asked for all of them', { tag: '@ai' }, async ({ page, app }) => {
    const s = session();
    await open(page, app, s.sessionId);
    await app.chat.say('show me all of them');
    await expect(app.chat.region().getByText(`All ${s.total} hotels that fit are listed under the top picks, in the same order.`)).toBeVisible({ timeout: 90_000 });
    await expect(app.results.fullCards()).toHaveCount(Math.min(s.more, 20));
    await expect(app.results.cards()).toHaveCount(s.picks);
  });
});

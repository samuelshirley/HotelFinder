import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import { Calendar } from '../pages/app';
import { AdminPage, CheckoutPage } from '../pages/checkout';
import { json } from '../support/api';
import { canonicalDates } from '../support/dates';
import { uniqueEmail } from '../support/env';
import { inventory } from '../support/inventory';
import * as S from '../support/schemas';
import { CLAIMS } from './registry';

/**
 * "Every button tested", made checkable. Each test below walks one part of the
 * app through its states, lists every interactive control on screen in each
 * (support/inventory.ts), and fails on any control no claim in registry.ts
 * matches. A claim names the test that exercises the control; the first test
 * here fails if that test does not exist. So a new button, link, input or
 * tab breaks CI until a test claims it.
 */
const E2E = path.resolve(__dirname, '..');

class Sweep {
  readonly unclaimed = new Map<string, string>();
  constructor(readonly page: Page) {}
  async at(state: string): Promise<void> {
    for (const c of await inventory(this.page)) {
      if (CLAIMS.some((claim) => claim.control.test(c.key))) continue;
      if (!this.unclaimed.has(c.key)) this.unclaimed.set(c.key, state);
    }
  }
  report(): string[] {
    return [...this.unclaimed].map(([key, state]) => `${key}   (seen in: ${state})`);
  }
}

const UNCLAIMED = 'controls on screen that no test claims (add a test, then a claim in e2e/guards/registry.ts)';

test.describe('coverage registry', { tag: '@coverage' }, () => {
  test('every claim names a test that exists', () => {
    const problems: string[] = [];
    for (const claim of CLAIMS) {
      const [file, title] = claim.by.split(' › ');
      let text: string;
      try {
        text = readFileSync(path.join(E2E, file), 'utf8');
      } catch {
        problems.push(`${claim.control}: ${file} does not exist`);
        continue;
      }
      if (!text.includes(title)) problems.push(`${claim.control}: no test titled "${title}" in ${file}`);
    }
    expect(problems).toEqual([]);
  });

  test('the first screen, in each of its states', async ({ page, app }) => {
    const sweep = new Sweep(page);
    await app.goto();
    await expect(app.trip.example()).toBeVisible();
    await sweep.at('first screen');
    await app.trip.where().click();
    await app.trip.placeInput().fill('porto');
    await expect(app.trip.suggestion('Porto', 'Portugal')).toBeVisible();
    await sweep.at('Where pill open');
    await app.trip.where().click();
    await app.trip.box().fill('Porto with my wife, 3 nights in March');
    await expect(app.trip.fullRow()).toBeVisible();
    await sweep.at('a sentence typed');
    await app.trip.box().fill('');
    await app.trip.when().click();
    await sweep.at('When pill open');
    await app.trip.when().click();
    await app.trip.who().click();
    await app.trip.party().more('children').click();
    await sweep.at('Who pill open, one child');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });

  test('the shortlist, its header editors, the map and the chat', async ({ page, app, searched }) => {
    const sweep = new Sweep(page);
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    await expect(app.results.map()).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await sweep.at('shortlist with the map');
    await app.results.map().getByLabel('Toggle attribution').click();
    await sweep.at('map credits unfolded');
    await app.results.changeWhere().click();
    await app.results.editor('where').getByLabel('New place').fill('lisbon');
    await expect(app.results.editor('where').getByRole('button').first()).toBeVisible();
    await sweep.at('Change where open');
    await app.results.changeWhere().click();
    await app.results.changeWhen().click();
    await sweep.at('Change when open');
    await app.results.changeWhen().click();
    await app.results.changeWho().click();
    await app.results.editor('who').getByRole('button', { name: 'More children' }).click();
    await sweep.at('Change who open, one child');
    await app.results.editor('who').getByRole('button', { name: 'Cancel' }).click();
    await app.results.priorities().click();
    await sweep.at('What matters open');
    await page.keyboard.press('Escape');
    // A point offered on the map, and the "around here" chips after a drag.
    const band = (await app.results.map().boundingBox())!;
    // From a corner (no pin under it), once the opening camera move is over.
    await page.waitForTimeout(1500);
    await page.mouse.move(band.x + 60, band.y + band.height - 50);
    await page.mouse.down();
    await page.mouse.move(band.x + 260, band.y + band.height - 80, { steps: 8 });
    await page.mouse.up();
    await expect(app.results.map().getByRole('button', { name: 'Search around here' })).toBeVisible();
    await sweep.at('map dragged away');
    await app.results.map().getByRole('button', { name: 'Search around here' }).click();
    await expect(page.getByRole('button', { name: /^Near the spot on your map/ })).toBeVisible({ timeout: 60_000 });
    await sweep.at('measuring from a point');
    await app.results.mapToggle().click();
    await sweep.at('map folded away');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });

  test('a hotel opened, both ways, with every module unfolded', async ({ page, app, searched }) => {
    const sweep = new Sweep(page);
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    for (let i = 0; i < searched.view.shortlist.length; i++) {
      await app.results.card(i).details().click();
      await expect(page.getByText('Loading the hotel…')).toHaveCount(0, { timeout: 60_000 });
      const panel = app.detail.panel();
      for (const name of [/^\+\d+ more$/, /^Show all \d+ rooms$/, /^Show all \d+ amenities$/, /^Read more$/]) {
        const b = panel.getByRole('button', { name });
        if (await b.count()) await b.first().click();
      }
      const room = panel.getByRole('button', { name: / From \S+ ▾$/ }).first();
      if (await room.count()) await room.click();
      for (const d of await panel.locator('details').all()) await d.locator('summary').click();
      await sweep.at(`slide-out, hotel ${i + 1}`);
      await app.detail.counter().click();
      await sweep.at('photos');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    await openSession(page, searched.sessionId, '?detail=expand');
    await app.results.waitForCards();
    await app.results.card(0).details().click();
    await expect(page.getByText('Loading the hotel…')).toHaveCount(0, { timeout: 60_000 });
    await sweep.at('expanded card');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });

  test('a narrow window, and the questions in the chat', async ({ page, app, searched, visitor }) => {
    const sweep = new Sweep(page);
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await page.setViewportSize({ width: 390, height: 780 });
    await sweep.at('narrow, chat tab');
    await app.sidebar.toggle().click();
    await sweep.at('narrow, trips drawer open');
    await page.setViewportSize({ width: 1360, height: 860 });

    const api = visitor.api();
    const { sessionId } = await json(await api.newSession(), S.sessionIdBody);
    await visitor.toBrowser();
    await page.evaluate((id) => localStorage.setItem('hf_session', id), sessionId);
    await page.reload();
    await sweep.at('question: where');
    await app.chat.say('porto');
    await app.chat.region().getByRole('button', { name: 'Porto · Portugal', exact: true }).click();
    await expect(app.chat.region().getByRole('button', { name: 'Use these nights' })).toBeVisible();
    await sweep.at('question: nights');
    const card = app.chat.region().locator('div').filter({ has: page.getByRole('button', { name: 'Use these nights' }) }).filter({ has: page.getByRole('grid') }).last();
    await new Calendar(card).pick(canonicalDates().checkIn, canonicalDates().checkOut);
    await card.getByRole('button', { name: 'Use these nights' }).click();
    await app.chat.region().getByRole('button', { name: 'More children' }).click();
    await sweep.at('question: who');
    // Back to the canonical party, so the search below is one the sandbox answers from its cache.
    await app.chat.region().getByRole('button', { name: 'Fewer children' }).click();
    await app.chat.region().getByRole('button', { name: 'That is everyone' }).click();
    await expect(app.chat.region().getByRole('button', { name: 'No preference' })).toBeVisible();
    await sweep.at('question: what matters');
    await app.chat.region().getByRole('button', { name: 'No preference' }).click();
    await app.results.waitForCards();
    await sweep.at('after the questions');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });

  test('the checkout, signed out and signed in, the sheet, the receipt and its cancel', { tag: '@booking' }, async ({ page, app, prebooked, visitor }) => {
    test.setTimeout(240_000);
    const sweep = new Sweep(page);
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await sweep.at('checkout, signed out');
    const email = uniqueEmail('sweep');
    await co.email().fill(email);
    await co.sendCode().click();
    const code = await co.readCode();
    await sweep.at('checkout, code sent');
    await co.code().fill(code);
    await co.first().fill('Ana');
    await co.last().fill('Silva');
    await co.pay('Apple Pay').click();
    await sweep.at('wallet sheet');
    await co.confirmIn('Apple Pay').click();
    await expect(co.heading()).toHaveText('Booked', { timeout: 90_000 });
    await sweep.at('receipt');
    await co.cancelBooking().click();
    await sweep.at('cancel this booking?');
    await co.yesCancel().click();
    await expect(co.heading()).toHaveText('Cancelled', { timeout: 60_000 });
    await sweep.at('cancelled');
    // Signed in now: a second checkout, and the app with the account and its bookings.
    await visitor.fromBrowser();
    const second = await json(await visitor.api().patient(() => visitor.api().checkout(prebooked.sessionId, { offerId: prebooked.view.shortlist.find((r) => r.offer)!.offer!.id })), S.bookingIdBody);
    await co.goto(second.bookingId);
    await sweep.at('checkout, signed in');
    await co.back().click();
    await expect(app.trip.box().or(app.results.region())).toBeVisible();
    // (Back lands on the first screen when this browser never opened the search itself; open it.)
    await page.evaluate((id) => localStorage.setItem('hf_session', id), prebooked.sessionId);
    await page.reload();
    await app.results.waitForCards();
    await sweep.at('app, signed in, with a booking');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });

  test('admin: the sign-in steps, the overview and one search', { tag: '@admin' }, async ({ page, visitor }) => {
    const sweep = new Sweep(page);
    const admin = new AdminPage(page);
    await page.goto('./admin');
    await sweep.at('admin sign-in, email');
    await admin.email().fill(uniqueEmail('sweep-admin'));
    await admin.submit().click();
    await expect(admin.devCode()).toBeVisible();
    await sweep.at('admin sign-in, code');
    await visitor.api().search();
    await admin.signIn((await import('../support/env')).ADMIN_EMAILS[1]);
    await expect(page.getByRole('heading', { name: 'Cost per search' })).toBeVisible();
    await sweep.at('admin overview');
    await page.getByRole('region', { name: 'Most expensive searches' }).getByRole('link').first().click();
    await expect(admin.calls()).toBeVisible();
    await sweep.at('admin search');
    expect(sweep.report(), UNCLAIMED).toEqual([]);
  });
});

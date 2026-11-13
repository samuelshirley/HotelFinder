import type { Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import { AppPage, Card } from '../pages/app';
import { json, type Api } from '../support/api';
import { ERROR_COPY } from '../support/copy';
import { nightsBetween } from '../support/dates';
import { MONEY, minor } from '../support/money';
import * as S from '../support/schemas';

/**
 * One hotel, opened (docs/design/hotel-detail.md): both variants of the
 * `detail` flag, every module and every control in it. The hotel used is the
 * shortlisted one whose listing has the most to show (photos, reviews with
 * more than four points, amenities beyond the top eight, a description and a
 * policy), chosen from the API, so no control is skipped for lack of data.
 */
type Rich = { index: number; details: S.SessionViewBody['shortlist'][number]; listing: Awaited<ReturnType<typeof listingOf>> };

async function listingOf(api: Api, sessionId: string, propertyId: string) {
  return json(await api.patient(() => api.property(sessionId, propertyId)), S.propertyDetailsBody);
}

async function richest(api: Api, sessionId: string, view: S.SessionViewBody): Promise<Rich> {
  let best: Rich | null = null;
  let bestScore = -1;
  for (const [index, row] of view.shortlist.entries()) {
    if (!row.offer) continue;
    const listing = await listingOf(api, sessionId, row.property.id);
    const r = listing.reviews;
    const score =
      (listing.imageUrls.length >= 5 ? 4 : 0) +
      (r && (r.pros.length > 4 || r.cons.length > 4) ? 4 : 0) +
      (listing.allFacilities.length > 12 ? 2 : 0) +
      (listing.description ? 1 : 0) +
      (listing.importantInformation ? 1 : 0) +
      (listing.latitude !== null ? 1 : 0);
    if (score > bestScore) {
      best = { index, details: row, listing };
      bestScore = score;
    }
  }
  return best!;
}

async function open(page: Page, app: AppPage, sessionId: string, variant: 'slideout' | 'expand', index: number): Promise<Card> {
  await openSession(page, sessionId, `?detail=${variant}`);
  await app.results.waitForCards();
  const card = app.results.card(index);
  await card.details().click();
  // The listing has arrived: the photos and modules below are the hotel's own, not the card's.
  await expect(page.getByText('Loading the hotel…')).toHaveCount(0, { timeout: 60_000 });
  return card;
}

test.describe('hotel detail, slide-out', { tag: '@ui' }, () => {
  test('opens from Details as a panel named for the hotel, with the price block first', { tag: '@content' }, async ({ page, app, searched, api }) => {
    const rich = await richest(api, searched.sessionId, searched.view);
    const row = rich.details;
    const nights = nightsBetween(searched.view.stay!.checkIn, searched.view.stay!.checkOut);
    const events = page.waitForRequest((r) => r.url().includes('/api/events'));
    await open(page, app, searched.sessionId, 'slideout', rich.index);
    // The open is logged for the A/B test (no personal data).
    expect((await events).postDataJSON()).toEqual({ name: 'detail_open', variant: 'slideout', sessionId: searched.sessionId });

    const panel = app.detail.panel();
    await expect(panel).toHaveAccessibleName(rich.listing.name);
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    // Header: rating and its word, reviews, stars, distance (docs/design/hotel-detail.md §2).
    const rating = row.property.rating;
    if (rating !== null) {
      const word = rating >= 9 ? ' Superb' : rating >= 8 ? ' Very good' : rating >= 7 ? ' Good' : '';
      await expect(panel.locator('header p').first()).toContainText(`${rating}${word}`);
    }
    if (row.property.stars) await expect(panel.getByLabel(`${row.property.stars} stars`)).toHaveText('★'.repeat(Math.round(row.property.stars)));

    // Price: the same total as the card, "N nights × per night · taxes & fees included", the terms, room · board.
    const price = app.detail.price();
    const total = (await price.locator('p').first().textContent())!.replace(/ total$/, '').trim();
    expect(total).toMatch(MONEY);
    expect(minor(total)).toBe(row.offer!.totalMinor);
    await expect(price).toContainText(new RegExp(`${nights} nights? × .+ · taxes & fees included`));
    const perNight = (await price.getByText(/ × /).textContent())!.match(/× (\S+) ·/)![1];
    expect(minor(perNight)).toBe(Math.ceil(row.offer!.totalMinor / nights));
    if (row.offer!.refundable) await expect(price.getByRole('list', { name: 'Cancellation' })).toBeVisible();
    else await expect(price.getByText('✕ Non-refundable')).toBeVisible();
    await expect(price).toContainText([row.offer!.roomName, row.offer!.boardName ?? 'Room only'].filter(Boolean).join(' · '));
    await expect(app.detail.bookIn(price)).toHaveText(`Book · ${total}`);
    // The book bar at the bottom says the same.
    await expect(panel.getByRole('button', { name: `Book · ${total}` })).toHaveCount(2);

    // Key facts: at most six, unknowns hidden.
    const facts = await app.detail.keyFacts().getByRole('listitem').allTextContents();
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.length).toBeLessThanOrEqual(6);
    expect(facts).toContain(row.offer!.refundable ? 'Free cancellation' : 'Non-refundable');
    // Facilities are curated: at most eight up front, compliance notices never.
    const amenities = app.detail.section('Amenities');
    expect(await amenities.getByRole('list').first().getByRole('listitem').count()).toBeLessThanOrEqual(8);
    await expect(panel.getByText(/protocol|sanitizer/i)).toHaveCount(0);
    // The hero photo keeps its height.
    expect((await panel.locator('img').first().boundingBox())!.height).toBeGreaterThan(150);
    await expect(page).toHaveLoadedImages('[role="dialog"]');
    await expect(page).toHaveWorkingLinks(api.request);
  });

  test('closes by ✕, by Esc and by the scrim, and focus returns to Details', async ({ page, app, searched }) => {
    const card = await open(page, app, searched.sessionId, 'slideout', 0);
    await expect(app.detail.panel()).toBeVisible();
    await app.detail.close().click();
    await expect(app.detail.panel()).toHaveCount(0);
    await expect(card.details()).toBeFocused();

    await card.details().click();
    await expect(app.detail.panel()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(app.detail.panel()).toHaveCount(0);

    await card.details().click();
    await expect(app.detail.panel()).toBeVisible();
    // The scrim: anywhere left of the panel.
    await page.mouse.click(20, 400);
    await expect(app.detail.panel()).toHaveCount(0);
  });

  test('opening the panel puts focus on the hotel\'s name', async ({ page, app, searched }) => {
    await open(page, app, searched.sessionId, 'slideout', 0);
    // SlideOut: "focus goes in on open" onto the element marked data-detail-heading, the hotel's name.
    await expect(app.detail.panel().getByRole('heading', { level: 2 })).toBeFocused();
  });

  test('Tab stays inside the open panel', async ({ page, app, searched }) => {
    await open(page, app, searched.sessionId, 'slideout', 0);
    const panel = app.detail.panel();
    expect(await panel.evaluate((el) => el.contains(document.activeElement)), 'focus went into the panel on open').toBe(true);
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      expect(await panel.evaluate((el) => el.contains(document.activeElement)), `Tab ${i + 1} left the panel`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });

  test('the card body opens the hotel too', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    await app.results.card(1).heading().click();
    await expect(app.detail.panel()).toHaveAccessibleName(searched.view.shortlist[1].property.name);
  });

  test('photos: each opens the lightbox there; arrows, keys, the counter and close', async ({ page, app, searched, api }) => {
    const rich = await richest(api, searched.sessionId, searched.view);
    await open(page, app, searched.sessionId, 'slideout', rich.index);
    const panel = app.detail.panel();
    const photos = panel.getByRole('button', { name: /^Photo \d+ of \d+$/ });
    await expect(photos.first()).toBeVisible();
    const shown = Number((await photos.first().getAttribute('aria-label'))!.match(/of (\d+)/)![1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(12);
    const lightbox = app.detail.lightbox();
    const count = lightbox.getByText(/^\d+\/\d+$/);
    for (let i = 0; i < (await photos.count()); i++) {
      await photos.nth(i).click();
      await expect(lightbox).toHaveAccessibleName(`Photos of ${rich.listing.name}`);
      await expect(count).toHaveText(`${i + 1}/${shown}`);
      await expect(lightbox.getByRole('button', { name: 'Close photos' })).toBeFocused();
      await lightbox.getByRole('button', { name: 'Close photos' }).click();
      await expect(lightbox).toHaveCount(0);
    }
    await app.detail.counter().click();
    await expect(app.detail.counter()).toHaveCount(1);
    await expect(count).toHaveText(`1/${shown}`);
    await lightbox.getByRole('button', { name: 'Next photo' }).click();
    await expect(count).toHaveText(`${Math.min(2, shown)}/${shown}`);
    await lightbox.getByRole('button', { name: 'Previous photo' }).click();
    await lightbox.getByRole('button', { name: 'Previous photo' }).click();
    await expect(count).toHaveText(`${shown}/${shown}`);
    await page.keyboard.press('ArrowRight');
    await expect(count).toHaveText(`1/${shown}`);
    await page.keyboard.press('ArrowLeft');
    await expect(count).toHaveText(`${shown}/${shown}`);
    await expect(page).toHaveLoadedImages('[aria-label^="Photos of"]');
    // Esc closes the photos, not the panel under them.
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(panel).toBeVisible();
  });

  test('the photo in the lightbox has a text alternative', async ({ page, app, searched }) => {
    await open(page, app, searched.sessionId, 'slideout', 0);
    await app.detail.counter().click();
    const img = app.detail.lightbox().locator('img');
    // The photo is the content of this dialog, not decoration: it needs a name ("Photo 1 of 12", or the supplier's caption).
    await expect(img).toHaveAccessibleName(/\S/);
  });

  test('reviews: category bars, what guests liked and watch out for, +N more and Show less', async ({ page, app, searched, api }) => {
    const rich = await richest(api, searched.sessionId, searched.view);
    const reviews = rich.listing.reviews!;
    expect(reviews, 'the richest hotel has a review summary').toBeTruthy();
    await open(page, app, searched.sessionId, 'slideout', rich.index);
    const section = app.detail.section('What guests say');
    await expect(section).toContainText('summary from the supplier');
    const liked = section.getByRole('heading', { name: 'Guests liked' }).locator('xpath=following-sibling::ul[1]').getByRole('listitem');
    if (reviews.pros.length) await expect(liked).toHaveCount(Math.min(4, reviews.pros.length));
    const more = Math.max(reviews.pros.length, reviews.cons.length) - 4;
    if (more > 0) {
      await section.getByRole('button', { name: `+${more} more` }).click();
      if (reviews.pros.length) await expect(liked).toHaveCount(reviews.pros.length);
      await section.getByRole('button', { name: 'Show less' }).click();
      await expect(section.getByRole('button', { name: `+${more} more` })).toBeVisible();
    }
    // Scores out of ten, as the supplier gives them.
    for (const c of reviews.categories.slice(0, 6)) await expect(section.getByText(c.name, { exact: true })).toBeVisible();
  });

  test('rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block', async ({ page, app, searched, api }) => {
    const rich = await richest(api, searched.sessionId, searched.view);
    const { rates } = await json(await api.patient(() => api.rates(searched.sessionId, rich.details.property.id)), S.ratesBody);
    await open(page, app, searched.sessionId, 'slideout', rich.index);
    const section = app.detail.section('Rooms & rates');
    if (rates.length <= 1) {
      // One rate is the one on the card: no section (design §6).
      await expect(section).toHaveCount(0);
      return;
    }
    const groups = new Map<string, number>();
    for (const r of rates) groups.set(r.roomName ?? 'Room', Math.min(groups.get(r.roomName ?? 'Room') ?? Infinity, r.totalMinor));
    const rows = section.getByRole('button', { name: / From \S+ [▾▴]$/ });
    await expect(rows).toHaveCount(Math.min(3, groups.size));
    const froms = [];
    for (const t of await rows.allTextContents()) froms.push(minor(t.match(/From (\S+)/)![1]));
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
    if (groups.size > 3) {
      await section.getByRole('button', { name: `Show all ${groups.size} rooms` }).click();
      await expect(rows).toHaveCount(groups.size);
      await section.getByRole('button', { name: 'Show fewer rooms' }).click();
      await expect(rows).toHaveCount(3);
    }
    // Open a room that is not the selected one, and select one of its rates.
    const otherName = (await rows.filter({ hasNotText: 'Selected' }).first().locator('span span').first().textContent())!.trim();
    const other = rows.filter({ hasText: otherName }).first();
    await other.click();
    await expect(other).toHaveAttribute('aria-expanded', 'true');
    const select = section.getByRole('button', { name: 'Select', exact: true }).first();
    const price = (await select.locator('xpath=..').locator('strong').textContent())!.trim();
    const board = (await select.locator('xpath=..').locator('span').first().textContent())!.trim();
    await select.click();
    await expect(app.detail.bookIn(app.detail.price())).toHaveText(`Book · ${price}`);
    await expect(app.detail.price()).toContainText(board);
    // The chosen rate now says Selected where its button was, and so does its room.
    const chosen = section.getByRole('listitem').filter({ has: page.locator('strong', { hasText: price }) }).filter({ hasText: board }).last();
    await expect(chosen.getByText('Selected')).toBeVisible();
    await expect(other).toContainText('Selected');
    await other.click();
    await expect(other).toHaveAttribute('aria-expanded', 'false');
  });

  test('good to know, amenities, about and location each open and close', async ({ page, app, searched, api }) => {
    const rich = await richest(api, searched.sessionId, searched.view);
    await open(page, app, searched.sessionId, 'slideout', rich.index);
    const panel = app.detail.panel();
    if (rich.listing.importantInformation) {
      const policy = app.detail.section('Good to know').locator('details');
      await expect(policy).not.toHaveAttribute('open', '');
      await policy.getByText('Full hotel policy').click();
      await expect(policy).toHaveAttribute('open', '');
      await expect(policy).toContainText('From the hotel:');
      await policy.getByText('Full hotel policy').click();
      await expect(policy).not.toHaveAttribute('open', '');
      // "Up to 3 verbatim sentences" (design §7), each one sentence with its spacing intact.
      const bullets = await app.detail.section('Good to know').getByRole('listitem').allTextContents();
      expect(bullets.length).toBeLessThanOrEqual(3);
      for (const b of bullets) expect(b, 'two sentences run together').not.toMatch(/[a-z]\.[A-Z]/);
    }
    const amenities = app.detail.section('Amenities');
    const all = amenities.getByRole('button', { name: /^Show all \d+ amenities$/ });
    if (await all.count()) {
      await all.click();
      await expect(amenities.getByRole('heading', { level: 4 }).first()).toBeVisible();
      await amenities.getByRole('button', { name: 'Show fewer' }).click();
      await expect(amenities.getByRole('heading', { level: 4 })).toHaveCount(0);
    }
    if (rich.listing.description) {
      const about = app.detail.section('About');
      const clamped = (await about.locator('div').first().boundingBox())!.height;
      await about.getByRole('button', { name: 'Read more' }).click();
      expect((await about.locator('div').first().boundingBox())!.height).toBeGreaterThanOrEqual(clamped);
      await about.getByRole('button', { name: 'Show less' }).click();
      await expect(about.getByRole('button', { name: 'Read more' })).toBeVisible();
    }
    if (rich.listing.latitude !== null && rich.listing.longitude !== null) {
      const maps = panel.getByRole('link', { name: 'Open in Maps' });
      await expect(maps).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${rich.listing.latitude},${rich.listing.longitude}`);
      await expect(maps).toHaveAttribute('target', '_blank');
      await expect(maps).toHaveAttribute('rel', /noopener/);
    }
    // ⓘ: what the total includes, when the supplier lists it.
    const info = app.detail.price().locator('details');
    if (await info.count()) {
      await info.locator('summary').click();
      await expect(info).toHaveAttribute('open', '');
      await expect(info.getByRole('listitem').first()).toHaveText(/: .+\d/);
    }
  });

  test('a listing that cannot be loaded says so, and the rest still works', async ({ page, app, searched, diagnostics }) => {
    diagnostics.allow(/\/api\/session\/[^/]+\/property\/[^/]+$/, 503, 'the listing call is made to fail on purpose');
    diagnostics.allow(/\/api\/session\/[^/]+\/property\/[^/]+\/rates$/, 503, 'the rates call is made to fail on purpose');
    await page.route(/\/api\/session\/[^/]+\/property\/[^/]+$/, (r) => r.fulfill({ status: 503, json: { error: 'supplier_unavailable' } }));
    let ratesFail = true;
    let retried = 0;
    await page.route(/\/api\/session\/[^/]+\/property\/[^/]+\/rates$/, (r) => {
      if (!ratesFail) retried++;
      return ratesFail ? r.fulfill({ status: 503, json: { error: 'supplier_unavailable' } }) : r.fallback();
    });
    await open(page, app, searched.sessionId, 'slideout', 0);
    const panel = app.detail.panel();
    await expect(panel.getByText(ERROR_COPY.supplier_unavailable)).toBeVisible();
    // The card's own offer still shows, and can still be booked.
    await expect(app.detail.price()).toBeVisible();
    // The other rates: unavailable, with Retry.
    const rates = app.detail.section('Rooms & rates');
    await expect(rates).toContainText('Other rates are unavailable right now');
    ratesFail = false;
    await rates.getByRole('button', { name: 'Retry' }).click();
    await expect(rates.getByText('Other rates are unavailable right now')).toHaveCount(0);
    expect(retried).toBe(1);
  });
});

test.describe('hotel detail, expanded in the list', { tag: '@ui' }, () => {
  test('Details expands the card in place; Collapse at the top and the bottom fold it', async ({ page, app, searched }) => {
    const card = await open(page, app, searched.sessionId, 'expand', 0);
    await expect(card.root.getByRole('heading', { name: 'Amenities' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card.root).toHaveAttribute('data-open', 'true');
    const collapses = card.root.getByRole('button', { name: 'Collapse ▲' });
    await expect(collapses).toHaveCount(2);
    await expect(collapses.first()).toHaveAttribute('aria-expanded', 'true');
    await collapses.first().click();
    await expect(card.root.getByRole('heading', { name: 'Amenities' })).toHaveCount(0);
    await card.details().click();
    await collapses.last().click();
    await expect(card.root.getByRole('heading', { name: 'Amenities' })).toHaveCount(0);
    await expect(card.details()).toHaveText('Details');
  });

  test('one card open at a time; the card body toggles it', async ({ page, app, searched }) => {
    const first = await open(page, app, searched.sessionId, 'expand', 0);
    await expect(first.root).toHaveAttribute('data-open', 'true');
    const second = app.results.card(1);
    await second.heading().click();
    await expect(second.root).toHaveAttribute('data-open', 'true');
    await expect(first.root).not.toHaveAttribute('data-open', 'true');
    await second.heading().click();
    await expect(second.root).not.toHaveAttribute('data-open', 'true');
  });

  test('Esc folds the open card (design: "Closes: ▲ Collapse (top and bottom), Esc")', async ({ page, app, searched }) => {
    const card = await open(page, app, searched.sessionId, 'expand', 0);
    await expect(card.root).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(card.root).not.toHaveAttribute('data-open', 'true');
  });

  test('the expanded card shows the same price and Book as the card', async ({ page, app, searched }) => {
    const card = await open(page, app, searched.sessionId, 'expand', 0);
    const total = (await card.total().textContent())!.trim();
    await expect(app.detail.price(card.root)).toBeVisible();
    await expect(app.detail.bookIn(card.root)).toHaveText(`Book · ${total}`);
    // The expanded card already shows the name and rating above: the detail's own header is hidden.
    await expect(card.root.getByRole('heading', { level: 2 })).toBeHidden();
  });
});

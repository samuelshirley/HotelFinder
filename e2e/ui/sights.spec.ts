import type { Locator, Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import type { AppPage } from '../pages/app';
import { json } from '../support/api';
import * as S from '../support/schemas';

/**
 * Sights (docs/sights.md): "I want to tour some museums" makes the search stay
 * close to the most popular museums and lays the days out from the best hotel.
 *
 * @ai: the request is read by the real Jev, the museums come from the real
 * Google Places, so these run only with E2E_AI=1 and a GOOGLE_MAPS_API_KEY
 * (scripts/google-key.sh). Each test makes one Google call (3.5 cents list
 * price). Nothing here names a museum: what Google returns changes, the rules
 * do not.
 */
const plan = (page: Page) => page.getByRole('region', { name: /^Museums in Porto, day by day$/ });
const days = (p: Locator) => p.locator('li[data-day]');
const stops = (p: Locator) => p.locator('li[data-day] ol a');
const routes = (p: Locator) => p.getByRole('link', { name: /^Open the walking route for day \d+ in Google Maps$/ });
const LINE = /^The most popular museums in Porto, by Google reviews: (.+?)(?:, and (\d+) more)?\. A plan for each day is above the hotels\./;

async function askForMuseums(page: Page, app: AppPage, sessionId: string, phone = false): Promise<{ named: string[]; more: number; text: string }> {
  await openSession(page, sessionId);
  await app.results.waitForCards();
  // A phone opens on the chat; the list is on its own tab, so the cards are waited for before the screen narrows.
  if (phone) await page.setViewportSize({ width: 390, height: 780 });
  await app.chat.say('I want to tour some museums');
  const line = app.chat.region().getByText(LINE);
  await expect(line).toBeVisible({ timeout: 90_000 });
  const text = (await line.textContent())!;
  const m = LINE.exec(text)!;
  return { named: m[1].split(/, | and /), more: Number(m[2] ?? 0), text };
}

test.describe('sights: a day-by-day museum plan', { tag: ['@ui', '@ai'] }, () => {
  test('museums asked for in the chat: Penny names the most popular, hotels are ranked close to them, and the plan starts from the best hotel', async ({ page, app, api, searched }) => {
    const nights = Math.round((Date.parse(searched.view.stay!.checkOut) - Date.parse(searched.view.stay!.checkIn)) / 86_400_000);
    const said = await askForMuseums(page, app, searched.sessionId);
    // What happened, never a count of hotels that fit.
    expect(said.text).not.toMatch(/hotels fit/);

    // The server's own rows: Google's, most reviewed first, all well rated, as many as the nights have time for.
    const view = await json(await api.session(searched.sessionId), S.sessionView);
    const sights = view.stay!.sights!;
    expect(sights.kind).toBe('museums');
    expect(sights.places).toHaveLength(Math.min(8, Math.max(3, nights * 2)));
    for (let i = 1; i < sights.places.length; i++) expect(sights.places[i - 1].reviewCount).toBeGreaterThanOrEqual(sights.places[i].reviewCount);
    // The line names the best known of exactly those, in that order, and counts the rest.
    expect(said.named).toEqual(sights.places.slice(0, said.named.length).map((p) => p.name));
    expect(said.named.length + said.more).toBe(sights.places.length);

    // "Close" is now the museums: on the chips, and as the point every card measures from.
    expect(view.stay).toMatchObject({ nearLabel: 'the museums', nearIsNamed: true, anchor: { label: 'the museums' } });
    expect(view.session.priorities).toContain('closest');
    await expect(app.results.region().getByRole('button', { name: 'Near the museums ✕' })).toBeVisible();
    await expect(app.results.card(0).root).toContainText('the museums');

    // The plan: every museum once, over no more days than nights, each a link to it on Google Maps by its place id.
    const p = plan(page);
    await expect(p).toBeVisible();
    await expect(days(p)).toHaveCount(Math.min(nights, Math.ceil(sights.places.length / 2)));
    await expect(stops(p)).toHaveCount(sights.places.length);
    const hrefs = await stops(p).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.map((h) => new URL(h).searchParams.get('query_place_id')).sort()).toEqual(sights.places.map((s) => s.placeId).sort());
    for (const h of hrefs) expect(h).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&/);
    for (const a of await stops(p).all()) await expect(a).toHaveAttribute('target', '_blank');
    await expect(p).toContainText('Google reviews');
    await expect(p).toContainText('Distances are straight lines');

    // Each day's route: walking, from the top hotel's own point, through that day's museums.
    const top = view.shortlist[0].property;
    await expect(routes(p)).toHaveCount(await days(p).count());
    for (const r of await routes(p).all()) {
      const url = new URL((await r.getAttribute('href'))!);
      expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
      expect(url.searchParams.get('travelmode')).toBe('walking');
      expect(url.searchParams.get('origin')).toBe(`${top.latitude},${top.longitude}`);
      expect(sights.places.map((s) => s.placeId)).toContain(url.searchParams.get('destination_place_id'));
    }

    // The museums are marked on the map, each a link, and none is mistaken for a hotel pin.
    await expect(page.locator('a[data-sight]')).toHaveCount(sights.places.length);
    await expect(page.locator('a[data-sight]').first()).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\//);
  });

  test('the plan starts from another listed hotel when one is picked, and Remove the plan puts "close" back', async ({ page, app, api, searched }) => {
    await askForMuseums(page, app, searched.sessionId);
    const view = await json(await api.session(searched.sessionId), S.sessionView);
    const p = plan(page);
    await expect(p).toBeVisible();
    const from = p.getByLabel('Starting from');
    const second = view.shortlist[1].property;
    await from.selectOption({ label: `2. ${second.name}` });
    for (const r of await routes(p).all()) {
      expect(new URL((await r.getAttribute('href'))!).searchParams.get('origin')).toBe(`${second.latitude},${second.longitude}`);
    }
    // Still every museum once.
    await expect(stops(p)).toHaveCount(view.stay!.sights!.places.length);

    await p.getByRole('button', { name: 'Remove the plan' }).click();
    await expect(p).toHaveCount(0);
    await expect(app.results.region().getByRole('button', { name: 'Near the museums ✕' })).toHaveCount(0);
    await expect(page.locator('a[data-sight]')).toHaveCount(0);
    const after = await json(await api.session(searched.sessionId), S.sessionView);
    expect(after.stay).toMatchObject({ sights: null, nearIsNamed: false });
    // Over a reload it stays gone.
    await page.reload();
    await app.results.waitForCards();
    await expect(plan(page)).toHaveCount(0);
  });

  test('a phone: the plan is on the Hotels tab above the list, fits the screen, and its days scroll sideways', async ({ page, app, searched }) => {
    await askForMuseums(page, app, searched.sessionId, true);
    const tab = (name: string | RegExp) => page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name });
    await tab(/^Hotels/).click();
    const p = plan(page);
    await expect(p).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const box = (await p.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // The plan comes before the first hotel.
    expect(box.y).toBeLessThan((await app.results.card(0).root.boundingBox())!.y);
    // More than one day: they sit side by side and the row scrolls, so the hotels are not pushed far down.
    if ((await days(p).count()) > 1) {
      const row = p.locator('ol').first();
      expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth + 2)).toBe(true);
      expect((await days(p).nth(0).boundingBox())!.y).toBe((await days(p).nth(1).boundingBox())!.y);
    }
    // Thumb-sized: the route link, the hotel picker and the remove button.
    for (const control of [routes(p).first(), p.getByLabel('Starting from'), p.getByRole('button', { name: 'Remove the plan' })]) {
      expect((await control.boundingBox())!.height, await control.evaluate((el) => el.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(40);
    }
    // The map tab marks the museums too.
    await tab('Map').click();
    await expect(page.locator('a[data-sight]').first()).toBeVisible();
  });
});

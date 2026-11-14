import type { Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import type { AppPage } from '../pages/app';
import { json } from '../support/api';
import { todayLocal } from '../support/dates';
import * as S from '../support/schemas';

/**
 * The map over the list (docs/design/map.md), in a real browser against the
 * live sandbox: real tiles, real pins. What is checked is what a person does
 * with it: find a hotel's card from its pin, fold the map away, zoom, and
 * search around another spot.
 */
async function openMap(page: Page, app: AppPage, sessionId: string) {
  await openSession(page, sessionId, '?detail=slideout');
  await app.results.waitForCards();
  await expect(app.results.map()).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await settle(page);
}

/** The camera has finished moving: the pins are where they were half a second ago. */
async function settle(page: Page) {
  const where = () => page.getByTestId('map').locator('button[data-pin]').evaluateAll((els) => JSON.stringify(els.map((e) => [Math.round(e.getBoundingClientRect().x), Math.round(e.getBoundingClientRect().y)])));
  let last = '';
  await expect.poll(async () => {
    const now = await where();
    const still = now === last && now !== '[]';
    last = now;
    return still;
  }, { intervals: [500], timeout: 15_000 }).toBe(true);
}

/** A point on the map with no pin or control under it, near a corner. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const band = (await page.getByTestId('map').boundingBox())!;
  for (const [fx, fy] of [[0.1, 0.8], [0.9, 0.8], [0.1, 0.3], [0.5, 0.85], [0.3, 0.5]]) {
    const x = band.x + band.width * fx;
    const y = band.y + band.height * fy;
    const busy = await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('button, a, summary, [data-anchor]')), [x, y]);
    if (!busy) return { x, y };
  }
  throw new Error('no empty spot on the map');
}

const overlaps = (page: Page) =>
  page
    .getByTestId('map')
    .locator('button[data-pin]')
    .evaluateAll((els) => {
      const r = els.map((el) => el.getBoundingClientRect());
      const out: string[] = [];
      // More than a pixel each way (sub-pixel rounding is not covering).
      for (let a = 0; a < r.length; a++)
        for (let b = a + 1; b < r.length; b++)
          if (Math.min(r[a].right, r[b].right) - Math.max(r[a].left, r[b].left) > 1 && Math.min(r[a].bottom, r[b].bottom) - Math.max(r[a].top, r[b].top) > 1) out.push(`${a + 1}+${b + 1}`);
      return out;
    });

test.describe('map', { tag: '@ui' }, () => {
  test.beforeEach(async ({ visitor }, info) => {
    // The canonical search, balanced: its hotels are central, so the map opens close in (a "Low price"
    // shortlist can reach the airport, 11 km out, and a drag then lands outside the town: near_too_far).
    const { sessionId } = await visitor.api().search();
    await visitor.toBrowser();
    info.annotations.push({ type: 'session', description: sessionId });
  });
  const session = () => test.info().annotations.find((a) => a.type === 'session')!.description!;

  test('a band over the list with a pin per card: its rank and the card\'s total, none covering another', async ({ page, app }) => {
    await openMap(page, app, session());
    const cards = app.results.cards();
    const n = await cards.count();
    const pins = app.results.pins();
    await expect(pins).toHaveCount(n);
    const band = (await app.results.map().boundingBox())!;
    expect(band.y + band.height).toBeLessThanOrEqual((await cards.first().boundingBox())!.y);
    expect(band.height).toBeGreaterThanOrEqual(200);
    expect(band.height).toBeLessThanOrEqual(320);
    expect(Math.round(band.width)).toBe(Math.round((await app.results.region().boundingBox())!.width));
    for (let i = 0; i < n; i++) {
      const total = (await app.results.card(i).total().textContent())!.trim();
      await expect(pins.nth(i)).toHaveText(`${i + 1} · ${total}`);
      await expect(pins.nth(i)).toHaveAttribute('aria-label', `${i + 1}. ${await app.results.card(i).name()}, ${total}`);
    }
    await expect(pins.first()).toHaveAttribute('data-compact', 'false');
    await expect.poll(() => overlaps(page), { timeout: 10_000 }).toEqual([]);
    for (let i = 0; i < n; i++) {
      const b = (await pins.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(band.x);
      expect(b.x + b.width).toBeLessThanOrEqual(band.x + band.width);
      expect(b.y).toBeGreaterThanOrEqual(band.y);
      expect(b.y + b.height).toBeLessThanOrEqual(band.y + band.height);
    }
    // The credits start folded: nothing drawn over the bottom pins.
    for (let i = 0; i < n; i++) {
      const covered = await pins.nth(i).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(top && !el.contains(top) && top.closest('.maplibregl-ctrl'));
      });
      expect(covered, `pin ${i + 1} is under a map control`).toBe(false);
    }
  });

  test('a pin and its card point at each other; a pressed pin stays marked and opens nothing', async ({ page, app }) => {
    await openMap(page, app, session());
    const pins = app.results.pins();
    const cards = app.results.cards();
    const last = (await cards.count()) - 1;
    await pins.nth(last).hover();
    await expect(cards.nth(last)).toHaveAttribute('data-marked', 'hover');
    await expect(cards.nth(last)).toBeInViewport();
    await cards.nth(0).hover();
    await expect(pins.nth(0)).toHaveAttribute('data-hover', 'true');
    await expect(cards.nth(last)).not.toHaveAttribute('data-marked', 'hover');
    await pins.nth(1).click();
    await page.mouse.move(5, 5);
    await expect(cards.nth(1)).toHaveAttribute('data-marked', 'selected');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the wheel zooms the map, not the list; Recentre brings the frame back', async ({ page, app }) => {
    await openMap(page, app, session());
    const list = app.results.cards().first().locator('xpath=ancestor::ol/..');
    // Let the list come to rest first (it scrolls itself into place on load).
    let last = -1;
    await expect.poll(async () => {
      const now = await list.evaluate((el) => el.scrollTop);
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [300], timeout: 10_000 }).toBe(true);
    const before = await list.evaluate((el) => el.scrollTop);
    // Not over a pin: a pin under the pointer brings its card into view, which is a scroll of its own.
    const spot = await emptySpot(page);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(600);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(before);
    const recentre = app.results.map().getByRole('button', { name: 'Recentre' });
    await expect(recentre).toBeVisible();
    await recentre.click();
    await expect(recentre).toHaveCount(0);
    await settle(page);
  });

  test('the zoom buttons zoom, and the (i) unfolds and folds the credits', async ({ page, app }) => {
    await openMap(page, app, session());
    const map = app.results.map();
    // How far apart the pins are: the widest distance between two of them.
    const spread = () => app.results.pins().evaluateAll((els) => {
      const c = els.map((e) => e.getBoundingClientRect()).map((r) => [r.left + r.width / 2, r.top + r.height / 2]);
      let max = 0;
      for (const a of c) for (const b of c) max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1]));
      return max;
    });
    const at = await spread();
    await map.getByRole('button', { name: 'Zoom in' }).click();
    // (Labels near each other stack and unstack as the zoom changes, so only the direction is checked.)
    await expect.poll(spread, { timeout: 5_000 }).toBeGreaterThan(at);
    await expect(map.getByRole('button', { name: 'Recentre' })).toBeVisible();
    await settle(page);
    const zoomedIn = await spread();
    await map.getByRole('button', { name: 'Zoom out' }).click();
    await map.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(spread, { timeout: 5_000 }).toBeLessThan(zoomedIn);
    const credits = map.getByRole('link', { name: 'OpenStreetMap' });
    await expect(credits).toBeHidden();
    await map.getByLabel('Toggle attribution').click();
    await expect(credits).toBeVisible();
    await expect(credits).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await map.getByLabel('Toggle attribution').click();
    await expect(credits).toBeHidden();
  });

  test('Search around here searches around the middle of the map; its chip undoes it', async ({ page, app }) => {
    await openMap(page, app, session());
    const map = app.results.map();
    const spot = await emptySpot(page);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x + (spot.x > 600 ? -200 : 200), spot.y - 30, { steps: 8 });
    await page.mouse.up();
    const around = map.getByRole('button', { name: 'Search around here' });
    await expect(around).toBeVisible();
    await around.click();
    await expect(app.chat.region().getByText(/Close to the spot on your map\./)).toBeVisible({ timeout: 60_000 });
    const chip = page.getByRole('button', { name: /^Near the spot on your map/ });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('title', 'Measure distance from the destination again');
    await expect(app.results.priorities()).toHaveText(/Close to the spot on your map/);
    await expect(map.locator('[data-anchor]')).toContainText('the spot on your map');
    await expect.poll(async () => {
      const a = (await map.locator('[data-anchor]').boundingBox())!;
      const now = (await map.boundingBox())!;
      return a.x >= now.x && a.x + a.width <= now.x + now.width && a.y >= now.y && a.y + a.height <= now.y + now.height;
    }, { timeout: 10_000 }).toBe(true);
    await expect(around).toHaveCount(0);
    await chip.click();
    await expect(map.locator('[data-anchor]')).toHaveCount(0, { timeout: 60_000 });
    await expect(app.chat.region().getByText(/^Close to central Porto again\./).last()).toBeVisible();
  });

  test('the place distances are measured from is marked on the map by its name', async ({ page, app, visitor }) => {
    await json(await visitor.api().edit(session(), { actions: [{ type: 'set_near_point', latitude: 41.1414, longitude: -8.6111, label: 'Ribeira' }], today: todayLocal() }), S.sessionView);
    await openMap(page, app, session());
    const anchor = app.results.map().locator('[data-anchor]');
    await expect(anchor).toContainText('Ribeira');
    // A marker that is focusable is announced by what it marks, not as a generic "Map marker" button.
    await expect(anchor).toHaveAccessibleName(/Ribeira/);
    // Pressing it changes nothing: it is a mark, not a control. It takes no pointer events (the press
    // lands on the map under it), so Playwright's actionability wait would never end: press the spot.
    await anchor.click({ force: true });
    await expect(app.results.cards().first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a named place on the map: pressing it offers "Measure from", and taking it measures from there', async ({ page, app }) => {
    await page.setViewportSize({ width: 2000, height: 900 });
    await openMap(page, app, session());
    const map = app.results.map();
    const measure = map.getByRole('button', { name: /^Measure from / });
    // Close in, so the names on the map are the town's own streets and squares.
    await map.getByRole('button', { name: 'Zoom in' }).click();
    await map.getByRole('button', { name: 'Zoom in' }).click();
    await settle(page);
    const area = (await map.boundingBox())!;
    /** Press the map, square by square, until a named place offers itself. */
    const findNamedPlace = async () => {
      for (let y = area.y + 60; y < area.y + area.height - 60; y += 40) {
        for (let x = area.x + 60; x < area.x + area.width - 80; x += 50) {
          const onButton = await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('button')), [x, y]);
          if (onButton) continue;
          await page.mouse.click(x, y);
          if (await measure.isVisible()) return;
        }
      }
    };
    await findNamedPlace();
    await expect(measure).toBeVisible();
    // Esc lets the offer go.
    await page.keyboard.press('Escape');
    await expect(measure).toHaveCount(0);
    await findNamedPlace();
    await expect(measure).toBeVisible();
    const place = (await measure.textContent())!.replace(/^Measure from /, '');
    await measure.click();
    await expect(measure).toHaveCount(0);
    await expect(app.chat.region().getByText(`Close to ${place}.`, { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: `Near ${place} ✕` })).toBeVisible();
    await expect(map.locator('[data-anchor]')).toContainText(place);
  });

  /**
   * The landmarks the map draws (MapPanel writes them when the map is still). Waits for a write after the
   * camera framed the hotels: pressing Zoom in before that would make the camera the user's, and the frame
   * would never come (seen on the phone run, 14 Nov 2026: the map stayed on West Africa).
   */
  async function landmarkSpots(page: Page, canvas: ReturnType<AppPage['results']['map']>) {
    await settle(page);
    let spots: { name: string; x: number; y: number }[] = [];
    await expect
      .poll(async () => {
        const raw = await canvas.getAttribute('data-landmark-spots');
        spots = raw ? JSON.parse(raw) : [];
        return raw !== null;
      }, { timeout: 30_000 })
      .toBe(true);
    return spots;
  }

  test('the map says where the museums and sights are, and pressing one measures from it', async ({ page, app }) => {
    // Sam, 14 Nov 2026: the grey map "doesn't tell you where the important things are. I want to know
    // how close I am to some museum." Landmarks are drawn from zoom 14, where the tiles start carrying them.
    await openMap(page, app, session());
    const map = app.results.map();
    const canvas = map.locator('div[role="region"]'); // MapLibre's own <canvas> carries the same name
    let spots = await landmarkSpots(page, canvas);
    // A frame wider than zoom 14 shows none yet: close in, as a person would.
    for (let i = 0; i < 3 && spots.length === 0; i++) {
      await map.getByRole('button', { name: 'Zoom in' }).click();
      await canvas.evaluate((el) => el.removeAttribute('data-landmark-spots'));
      spots = await landmarkSpots(page, canvas);
    }
    expect(spots.length, 'landmarks drawn near the hotels').toBeGreaterThan(0);
    expect(Number(await canvas.getAttribute('data-landmarks'))).toBeGreaterThan(0);

    // Press one that has no pin or control on top of it.
    const box = (await canvas.boundingBox())!;
    let pressed: string | null = null;
    for (const spot of spots) {
      // Drawn just past the edge (a label overhangs it): not one a person could press.
      if (spot.x < 24 || spot.y < 24 || spot.x > box.width - 24 || spot.y > box.height - 24) continue;
      const x = box.x + spot.x;
      const y = box.y + spot.y;
      const covered = await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('button, a, [data-anchor]')), [x, y]);
      if (covered) continue;
      await page.mouse.click(x, y);
      pressed = spot.name;
      break;
    }
    expect(pressed, 'a landmark clear of the pins').not.toBeNull();
    const measure = map.getByRole('button', { name: `Measure from ${pressed!.slice(0, 80)}`, exact: true });
    await expect(measure).toBeVisible();
    // The offer is above every pin, so it can be pressed wherever it opens (it once opened under two).
    await measure.click();
    await expect(app.chat.region().getByText(`Close to ${pressed}.`, { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(map.locator('[data-anchor]')).toContainText(pressed!);
  });

  test('a phone: the Map tab, built while hidden, opens on the hotels and shows the landmarks', async ({ page, app }) => {
    // Phone-sized from the start, so the map is built (and frames the hotels) while its tab is hidden at
    // zero size: in CI that opened the tab on West Africa for a Porto search (2026-11-14).
    await page.setViewportSize({ width: 390, height: 780 });
    await openSession(page, session());
    const map = app.results.map();
    await expect(map).toBeHidden();
    await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await page.getByRole('tab', { name: 'Map' }).click();
    await expect(map).toBeVisible();
    await settle(page);
    // Framed on the hotels: every pin inside the map, and no Recentre (the camera is still the app's).
    const area = (await map.boundingBox())!;
    for (const pin of await app.results.pins().all()) {
      const at = (await pin.boundingBox())!;
      expect(at.x + at.width / 2).toBeGreaterThan(area.x);
      expect(at.x + at.width / 2).toBeLessThan(area.x + area.width);
      expect(at.y + at.height / 2).toBeGreaterThan(area.y);
      expect(at.y + at.height / 2).toBeLessThan(area.y + area.height);
    }
    await expect(map.getByRole('button', { name: 'Recentre' })).toHaveCount(0);
    const canvas = map.locator('div[role="region"]');
    let spots = await landmarkSpots(page, canvas);
    for (let i = 0; i < 3 && spots.length === 0; i++) {
      await map.getByRole('button', { name: 'Zoom in' }).click();
      await canvas.evaluate((el) => el.removeAttribute('data-landmark-spots'));
      spots = await landmarkSpots(page, canvas);
    }
    expect(spots.length, 'landmarks drawn on the phone map').toBeGreaterThan(0);
  });

  test('Hide map folds it away, and it stays away over a reload until Show map', async ({ page, app }) => {
    await openMap(page, app, session());
    await app.results.mapToggle().click();
    await expect(app.results.map()).toHaveCount(0);
    await expect(app.results.mapToggle()).toHaveText('Show map');
    await expect(app.results.mapToggle()).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await app.results.waitForCards();
    await expect(app.results.map()).toHaveCount(0);
    await app.results.mapToggle().click();
    await expect(app.results.map()).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(app.results.mapToggle()).toHaveText('Hide map');
  });

  test('a wide window: the map beside the list, the card keeps its price column', async ({ page, app }) => {
    await openMap(page, app, session());
    await page.setViewportSize({ width: 2000, height: 900 });
    const wideMap = (await app.results.map().boundingBox())!;
    const card = app.results.card(0);
    const wideCard = (await card.root.boundingBox())!;
    expect(wideMap.x).toBeGreaterThanOrEqual(wideCard.x + wideCard.width);
    expect(wideMap.height).toBeGreaterThan(500);
    expect(wideCard.width).toBeGreaterThanOrEqual(560);
    const name = (await card.heading().boundingBox())!;
    const book = (await card.book().boundingBox())!;
    expect(book.x).toBeGreaterThan(name.x + name.width - 1);
  });

  test('Penny folds the map away when asked in words', { tag: '@ai' }, async ({ page, app }) => {
    await openMap(page, app, session());
    await app.chat.say('hide the map');
    await expect(app.chat.region().getByText('The map is folded away.')).toBeVisible({ timeout: 90_000 });
    await expect(app.results.map()).toHaveCount(0);
    await expect(app.results.mapToggle()).toHaveText('Show map');
  });
});

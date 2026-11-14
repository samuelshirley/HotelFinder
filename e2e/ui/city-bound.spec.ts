import { expect, openSession, test } from '../fixtures/test';
import { json } from '../support/api';
import * as S from '../support/schemas';

/**
 * A city searched with nothing named keeps to the city (docs/finder.md, "In
 * the city"). Reported on the live site 2026-11-14: Madrid, "cheap and well
 * rated", listed Valdebebas and Alcobendas, 11–14 km out, in the top five.
 * Live sandbox data: the names and distances are read, never fixed, except the
 * towns the report named, which are outside Madrid in any recording.
 *
 * Madrid's hotels are compact (the median one 1.3 km from the middle on
 * 2026-11-14), so the bound is the 8 km floor.
 */
const SUBURBS = /Alcobendas|Valdebebas|San Sebasti[aá]n de los Reyes|Coslada/;

for (const size of ['desktop', 'phone'] as const) {
  test(`Madrid, cheap and well rated (${size}): every hotel listed is in the city`, { tag: '@ui' }, async ({ page, app, visitor }) => {
    test.setTimeout(180_000);
    const api = visitor.api();
    const places = (await (await api.patient(() => api.places('madrid'))).json()) as { places?: Array<{ placeId: string; label: string }> };
    const madrid = places.places?.find((p) => /^Madrid, Spain$/.test(p.label));
    expect(madrid, 'the place search names "Madrid, Spain"').toBeDefined();
    const { sessionId, view } = await api.search({ place: { placeId: madrid!.placeId, label: madrid!.label }, priorities: ['cheapest', 'nicest'] });
    expect(view.shortlist.length).toBe(5);

    // Every row that fits, the top picks and the full list, on the 100 m steps the cards show.
    const pages = view.fullList.more > 0 ? Math.ceil(view.fullList.more / view.fullList.pageSize) : 0;
    const rows = [...view.shortlist];
    for (let p = 1; p <= pages; p++) rows.push(...(await json(await api.hotels(sessionId, `?page=${p}`), S.fullListBody)).rows);
    expect(rows.length).toBe(view.fullList.total);
    for (const row of rows) {
      expect(row.property.name).not.toMatch(SUBURBS);
      expect((row.reason as { distance_km: number }).distance_km, row.property.name).toBeLessThanOrEqual(8);
    }

    await visitor.toBrowser();
    await openSession(page, sessionId);
    if (size === 'phone') {
      await page.setViewportSize({ width: 390, height: 780 });
      await page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: /^Hotels/ }).click();
    }
    await app.results.waitForCards();
    await expect(app.results.cards()).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const card = app.results.card(i);
      await expect(card.root).toBeVisible();
      expect(await card.name()).not.toMatch(SUBURBS);
      const km = /· (\d+) m|· (\d+\.\d) km/.exec((await card.root.textContent()) ?? '');
      expect(km, `card ${i + 1} shows its distance`).not.toBeNull();
      expect(km![1] ? Number(km![1]) / 1000 : Number(km![2])).toBeLessThanOrEqual(8);
    }
  });
}

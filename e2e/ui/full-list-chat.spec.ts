import { expect, openSession, test } from '../fixtures/test';
import { json } from '../support/api';
import * as S from '../support/schemas';

/**
 * Penny sees the full list (Sam, 2026-11-14: "hotels only in the full list are
 * invisible to Penny"). A hotel named by the number on its card, past the top
 * picks and on a page nobody has opened, is opened: the full list opens on
 * that page first. docs/agent.md, "The full list".
 *
 * @ai: the message is read by the real Jev, so this runs only with E2E_AI=1.
 */
for (const size of [
  { name: 'desktop', width: 1360, height: 860 },
  { name: 'phone', width: 390, height: 780 },
]) {
  test(`"open number N" opens a hotel from an unopened page of the full list (${size.name})`, { tag: ['@ui', '@ai'] }, async ({ page, app, api, searched }) => {
    const { sessionId, view } = searched;
    const picks = view.fullList.total - view.fullList.more;
    expect(view.fullList.more, 'the search has hotels after the top picks').toBeGreaterThan(0);
    // The last page's last hotel: on page 2 or later whenever the list has one.
    const pages = Math.ceil(view.fullList.more / 20);
    const last = await json(await api.hotels(sessionId, `?page=${pages}`), S.fullListBody);
    const target = last.rows.at(-1)!;
    const n = target.rank;
    expect(n).toBe(picks + view.fullList.more);

    await page.setViewportSize({ width: size.width, height: size.height });
    await openSession(page, sessionId, '?detail=slideout');
    if (size.name === 'phone') await page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: 'Chat' }).click();
    await app.chat.say(`open number ${n}`);

    // The hotel itself, open, and the full list on the page that holds it.
    await expect(app.detail.panel()).toBeVisible({ timeout: 90_000 });
    await expect(app.detail.panel()).toContainText(target.property.name);
    await app.detail.close().click();
    if (size.name === 'phone') await expect(page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: /^Hotels/ })).toHaveAttribute('aria-selected', 'true');
    await expect(app.results.fullList()).toContainText(new RegExp(`Hotels ${picks + (pages - 1) * 20 + 1}–${n} of ${n}`));
    await expect(page.locator(`#hotel-${target.property.id}`)).toBeVisible();
    // And Penny said which one (a phone shows the chat under its own tab).
    if (size.name === 'phone') await page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: 'Chat' }).click();
    await expect(app.chat.region().getByText(`${target.property.name} is open.`).last()).toBeVisible();
  });
}

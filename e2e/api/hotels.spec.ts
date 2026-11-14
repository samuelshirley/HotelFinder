import { expect, stranger, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import * as S from '../support/schemas';

/**
 * "Show all N hotels" (docs/finder.md, "The full list"): the finder's ranked
 * rows after the top picks, a page at a time, in the session view's row shape.
 * Read only: nothing is ranked, priced or fetched here.
 */
test.describe('GET /api/session/[id]/hotels', { tag: '@api' }, () => {
  test('page 1: the rows after the top picks, in order, none of them a top pick, public prices only', async ({ api, searched }) => {
    const res = await api.hotels(searched.sessionId);
    const body = await json(res, S.fullListBody);
    expect(body.more).toBe(searched.view.fullList.more);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(searched.view.fullList.pageSize);
    expect(body.rows.length).toBe(Math.min(body.more, body.pageSize));
    expect(searched.view.fullList.total).toBe(searched.view.shortlist.filter((r) => (r.reason as { kind?: string } | null)?.kind !== 'near_miss').length + body.more);
    const picks = new Set(searched.view.shortlist.map((r) => r.property.id));
    const lastRank = Math.max(...searched.view.shortlist.map((r) => r.rank));
    body.rows.forEach((r, i) => {
      expect(picks.has(r.property.id)).toBe(false);
      expect(r.source).toBe('finder');
      expect(r.rank).toBe(lastRank + 1 + i);
      expect(r.offer?.audience ?? 'public').toBe('public');
    });
  });

  test('a hotel from the full list opens like a top pick: its listing and its rates', async ({ api, searched }) => {
    expect(searched.view.fullList.more, 'the canonical Porto search has hotels after the top picks').toBeGreaterThan(0);
    const { rows } = await json(await api.hotels(searched.sessionId), S.fullListBody);
    await json(await api.patient(() => api.property(searched.sessionId, rows[0].property.id)), S.propertyDetailsBody);
    await json(await api.patient(() => api.rates(searched.sessionId, rows[0].property.id)), S.ratesBody);
  });

  test('a page past the end is the last page; a search still being set up has no list', async ({ api, searched }) => {
    const body = await json(await api.hotels(searched.sessionId, '?page=50'), S.fullListBody);
    expect(body.page).toBe(Math.max(1, Math.ceil(body.more / body.pageSize)));
    const { sessionId } = await json(await api.newSession(), S.sessionIdBody);
    expect(await json(await api.hotels(sessionId), S.fullListBody)).toEqual({ more: 0, page: 1, pageSize: body.pageSize, rows: [] });
  });

  test('a page that is not a positive number, none, or another parameter: invalid_request', async ({ api, searched }) => {
    for (const q of ['', '?page=0', '?page=-1', '?page=1.5', '?page=two', '?page=1&sort=price', '?page=100000']) await expectError(await api.hotels(searched.sessionId, q), 400, 'invalid_request');
  });

  test('another visitor\'s search, or no cookie: 404 session_not_found', async ({ searched, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.get(`api/session/${searched.sessionId}/hotels?page=1`), 404, 'session_not_found');
    await other.dispose();
  });
});

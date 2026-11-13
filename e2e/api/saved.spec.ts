import { expect, stranger, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import { uniqueEmail } from '../support/env';
import * as S from '../support/schemas';

/**
 * The heart (docs/saved.md): a hotel on the visitor's own list, saved for the
 * visitor (the account, or the signed cookie before sign-in), listed with its
 * last price found, never a current one. Both methods answer the whole list.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

test.describe('GET /api/saved', { tag: '@api' }, () => {
  test('no cookie: nothing saved', async ({ api }) => {
    expect(await json(await api.saved(), S.savedBody)).toEqual({ saved: [] });
  });

  test('another visitor\'s saved hotels are not listed', async ({ api, searched, ip }) => {
    await json(await api.save({ saved: true, propertyId: searched.view.shortlist[0].property.id, sessionId: searched.sessionId }), S.savedBody);
    const other = await stranger(ip);
    expect(await json(await other.get('api/saved'), S.savedBody)).toEqual({ saved: [] });
    await other.dispose();
  });
});

test.describe('POST /api/saved', { tag: '@api' }, () => {
  test('saves a hotel from this search with its last price found; once only; unsaves it', async ({ api, searched }) => {
    const row = searched.view.shortlist.find((r) => r.offer)!;
    const { saved } = await json(await api.save({ saved: true, propertyId: row.property.id, sessionId: searched.sessionId }), S.savedBody);
    expect(saved).toEqual([
      expect.objectContaining({
        propertyId: row.property.id,
        name: row.property.name,
        sessionId: searched.sessionId,
        // The newest offer found for it, for the nights it was for: this search's.
        lastFound: expect.objectContaining({ totalMinor: row.offer!.totalMinor, currency: row.offer!.currency, checkIn: searched.view.stay!.checkIn, checkOut: searched.view.stay!.checkOut }),
      }),
    ]);
    // Saving again does not double it.
    expect((await json(await api.save({ saved: true, propertyId: row.property.id, sessionId: searched.sessionId }), S.savedBody)).saved).toHaveLength(1);
    expect((await json(await api.saved(), S.savedBody)).saved).toHaveLength(1);
    // Unsaving needs only the hotel.
    expect(await json(await api.save({ saved: false, propertyId: row.property.id }), S.savedBody)).toEqual({ saved: [] });
  });

  test('newest first', async ({ api, searched }) => {
    const [a, b] = searched.view.shortlist;
    await json(await api.save({ saved: true, propertyId: a.property.id, sessionId: searched.sessionId }), S.savedBody);
    const { saved } = await json(await api.save({ saved: true, propertyId: b.property.id, sessionId: searched.sessionId }), S.savedBody);
    expect(saved.map((h) => h.propertyId)).toEqual([b.property.id, a.property.id]);
  });

  test('a hotel from "Show all" can be saved too: it is on this search\'s list', async ({ api, searched }) => {
    expect(searched.view.fullList.more, 'the canonical Porto search has hotels after the top picks').toBeGreaterThan(0);
    const { rows } = await json(await api.hotels(searched.sessionId), S.fullListBody);
    const res = await api.save({ saved: true, propertyId: rows[0].property.id, sessionId: searched.sessionId });
    expect((await json(res, S.savedBody)).saved.map((h) => h.propertyId)).toEqual([rows[0].property.id]);
  });

  test('only a hotel on this visitor\'s own list: an unknown hotel or another visitor\'s search saves nothing', async ({ api, searched, ip }) => {
    await expectError(await api.save({ saved: true, propertyId: UNKNOWN, sessionId: searched.sessionId }), 404, 'property_not_found');
    const other = await stranger(ip);
    await expectError(await other.post('api/saved', { data: { saved: true, propertyId: searched.view.shortlist[0].property.id, sessionId: searched.sessionId } }), 404, 'session_not_found');
    expect(await json(await other.get('api/saved'), S.savedBody)).toEqual({ saved: [] });
    await other.dispose();
    expect((await json(await api.saved(), S.savedBody)).saved).toEqual([]);
  });

  test('unsaving with no cookie, or a hotel never saved, is a no-op that answers the list', async ({ api }) => {
    expect(await json(await api.save({ saved: false, propertyId: UNKNOWN }), S.savedBody)).toEqual({ saved: [] });
  });

  test('one schema: anything else is invalid_request', async ({ api, searched }) => {
    const id = searched.view.shortlist[0].property.id;
    await expectError(await api.save({ saved: true, propertyId: id }), 400, 'invalid_request');
    await expectError(await api.save({ saved: false, propertyId: id, sessionId: searched.sessionId }), 400, 'invalid_request');
    await expectError(await api.save({ saved: 'yes', propertyId: id }), 400, 'invalid_request');
    await expectError(await api.save({ saved: true, propertyId: 'nope', sessionId: searched.sessionId }), 400, 'invalid_request');
    await expectError(await api.save({ propertyId: id }), 400, 'invalid_request');
  });

  test('saved before sign-in, the account keeps them; signed out, the cookie sees none', async ({ api, searched }) => {
    const id = searched.view.shortlist[0].property.id;
    await json(await api.save({ saved: true, propertyId: id, sessionId: searched.sessionId }), S.savedBody);
    await api.signIn(uniqueEmail('saved'));
    expect((await json(await api.saved(), S.savedBody)).saved.map((h) => h.propertyId)).toEqual([id]);
    await api.signOut();
    expect(await json(await api.saved(), S.savedBody)).toEqual({ saved: [] });
  });
});

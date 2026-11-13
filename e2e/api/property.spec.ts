import { expect, stranger, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import * as S from '../support/schemas';

/**
 * One shortlisted hotel: its listing (supplier text as plain text) and every
 * room and rate it has for the stay. Only a hotel on this visitor's own
 * shortlist can be opened.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

test.describe('GET /api/session/[id]/property/[propertyId]', { tag: '@api' }, () => {
  test('the listing, in the strict shape, as plain text, bounded', async ({ api, searched }) => {
    const row = searched.view.shortlist[0];
    const listing = await json(await api.patient(() => api.property(searched.sessionId, row.property.id)), S.propertyDetailsBody);
    expect(listing.id).toBe(row.property.id);
    expect(listing.name.length).toBeGreaterThan(0);
    // "Supplier text is data and is sent as plain text": no markup, no entities.
    for (const text of [listing.name, listing.description ?? '', listing.importantInformation ?? '', ...listing.allFacilities]) {
      expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(text).not.toMatch(/&(amp|lt|gt|quot|#\d+);/);
    }
    expect(listing.imageUrls.every((u) => u.startsWith('https://'))).toBe(true);
    expect(listing.facilities.length).toBeLessThanOrEqual(40);
  });

  test('a hotel that is not on this shortlist is property_not_found', async ({ api, searched }) => {
    await expectError(await api.property(searched.sessionId, UNKNOWN), 404, 'property_not_found');
    await expectError(await api.property(searched.sessionId, 'not-a-uuid'), 404, 'property_not_found');
  });

  test('another visitor\'s search: 404 session_not_found', async ({ searched, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.get(`api/session/${searched.sessionId}/property/${searched.view.shortlist[0].property.id}`), 404, 'session_not_found');
    await other.dispose();
  });
});

test.describe('GET /api/session/[id]/property/[propertyId]/rates', { tag: '@api' }, () => {
  test('every rate is bookable by its own offer id, priced in the search\'s currency', async ({ api, searched }) => {
    const row = searched.view.shortlist[0];
    const { rates } = await json(await api.patient(() => api.rates(searched.sessionId, row.property.id)), S.ratesBody);
    expect(rates.length).toBeGreaterThan(0);
    expect(new Set(rates.map((r) => r.offerId)).size).toBe(rates.length);
    for (const r of rates) {
      expect(r.currency).toBe(searched.view.session.currency);
      if (!r.refundable) expect(r.freeCancellationUntil).toBeNull();
      for (const f of r.fees) expect(f.currency).toBe(r.currency);
    }
  });

  test('a hotel that is not on this shortlist is property_not_found; another visitor\'s search is session_not_found', async ({ api, searched, ip }) => {
    await expectError(await api.rates(searched.sessionId, UNKNOWN), 404, 'property_not_found');
    const other = await stranger(ip);
    await expectError(await other.get(`api/session/${searched.sessionId}/property/${searched.view.shortlist[0].property.id}/rates`), 404, 'session_not_found');
    await other.dispose();
  });
});

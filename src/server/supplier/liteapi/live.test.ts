import { describe, expect, it } from 'vitest';

import type { SearchRequest } from '../types';
import { createLiteApiAdapter } from './adapter';

/**
 * The adapter against the REAL sandbox. Skipped unless LIVE_LITEAPI=1, so
 * `npm run test` stays offline:
 *
 *   set -a; . ./.env; set +a; LIVE_LITEAPI=1 npx vitest run src/server/supplier/liteapi/live.test.ts
 *
 * Refuses a non-sandbox key. Makes no booking.
 */
const key = process.env.LITE_API_KEY ?? '';
const live = process.env.LIVE_LITEAPI === '1';

describe.runIf(live)('LiteAPI sandbox, live', () => {
  const supplier = createLiteApiAdapter({ apiKey: key });
  const stay = (over: Partial<SearchRequest> = {}): SearchRequest => {
    const checkIn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10);
    return {
      where: { cityName: 'Porto', countryCode: 'PT' },
      checkIn,
      checkOut,
      occupancies: [{ adults: 2, childrenAges: [] }],
      currency: 'EUR',
      guestNationality: 'ES',
      marginPct: 0,
      maxHotels: 10,
      maxRatesPerHotel: 1,
      ...over,
    };
  };

  it('uses a sandbox key', () => {
    expect(key.startsWith('sand_')).toBe(true);
  });

  it('finds a place, searches by it, and every offer normalizes', async () => {
    const places = await supplier.searchPlaces('Ribeira Porto');
    expect(places.ok).toBe(true);
    if (!places.ok) return;
    const search = await supplier.searchAvailability(stay({ where: { placeId: places.value[0].placeId } }));
    expect(search).toMatchObject({ ok: true });
    if (!search.ok) return;
    expect(search.value.offers.length).toBeGreaterThan(0);
    for (const o of search.value.offers) {
      expect(Number.isInteger(o.total.amountMinor)).toBe(true);
      expect(o.total.amountMinor).toBeGreaterThan(0);
      expect(o.supplierOfferId.length).toBeGreaterThan(20);
    }
  }, 60_000);

  it('accepts children by age across two rooms', async () => {
    const search = await supplier.searchAvailability(
      stay({ occupancies: [{ adults: 2, childrenAges: [4, 9] }, { adults: 2, childrenAges: [] }], maxHotels: 5 }),
    );
    expect(search).toMatchObject({ ok: true });
    if (!search.ok) return;
    const twoRooms = search.value.offers.filter((o) => o.rooms.length === 2);
    expect(twoRooms.length).toBeGreaterThan(0);
    expect(twoRooms[0].rooms[0].childrenAges).toEqual([4, 9]);
  }, 60_000);

  it('a margin raises the price of the same hotel', async () => {
    const net = await supplier.searchAvailability(stay({ where: { hotelIds: ['lp76a2a'] } }));
    const marked = await supplier.searchAvailability(stay({ where: { hotelIds: ['lp76a2a'] }, marginPct: 10 }));
    expect(net.ok && marked.ok).toBe(true);
    if (!net.ok || !marked.ok) return;
    expect(net.value.offers.length).toBeGreaterThan(0);
    expect(marked.value.offers.length).toBeGreaterThan(0);
    const ratio = marked.value.offers[0].total.amountMinor / net.value.offers[0].total.amountMinor;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.2);
  }, 60_000);

  it('re-checks a rate and gets a prebook id, a transaction id and a client secret', async () => {
    const search = await supplier.searchAvailability(stay({ maxHotels: 3 }));
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    const check = await supplier.recheckRate(search.value.offers[0].supplierOfferId);
    expect(check).toMatchObject({ ok: true });
    if (!check.ok) return;
    expect(check.value.prebookId.length).toBeGreaterThan(3);
    expect(check.value.transactionId.length).toBeGreaterThan(3);
    expect(check.value.clientSecret.length).toBeGreaterThan(10);
    expect(check.value.total.currency).toBe('EUR');
  }, 90_000);

  it('static content and an unknown booking', async () => {
    const details = await supplier.getStaticContent('lp76a2a');
    expect(details.ok && details.value.name).toBe('Vincci Porto');
    expect(await supplier.getBooking('does-not-exist')).toMatchObject({ ok: false, error: { kind: 'supplier', status: 404 } });
  }, 60_000);
});

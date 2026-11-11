import { describe, expect, it, vi } from 'vitest';

import type { SearchRequest, SupplierMeterEvent } from '../types';
import { createLiteApiAdapter } from './adapter';
import { replay, type Loose } from './fixtures';
import type { FetchLike } from './http';

const KEY = 'sand_test-key-never-real';
const NOW = new Date('2026-11-11T12:00:00Z');

function adapter(fetchImpl: FetchLike) {
  const events: SupplierMeterEvent[] = [];
  const supplier = createLiteApiAdapter({ apiKey: KEY, fetchImpl, now: () => NOW, meter: (e) => void events.push(e) });
  return { supplier, events };
}

const PORTO: SearchRequest = {
  where: { cityName: 'Porto', countryCode: 'PT' },
  checkIn: '2026-12-11',
  checkOut: '2026-12-13',
  occupancies: [
    { adults: 2, childrenAges: [4, 9] },
    { adults: 2, childrenAges: [] },
  ],
  currency: 'EUR',
  guestNationality: 'ES',
  marginPct: 3,
  maxHotels: 20,
  maxRatesPerHotel: 1,
};

describe('searchAvailability', () => {
  it('sends exactly the request the supplier needs', async () => {
    const { fetchImpl, calls } = replay('rates-city-porto');
    const { supplier } = adapter(fetchImpl);
    await supplier.searchAvailability(PORTO);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.liteapi.travel/v3.0/hotels/rates');
    expect(calls[0].headers['X-API-Key']).toBe(KEY);
    expect(calls[0].body).toEqual({
      cityName: 'Porto',
      countryCode: 'PT',
      checkin: '2026-12-11',
      checkout: '2026-12-13',
      occupancies: [
        { adults: 2, children: [4, 9] },
        { adults: 2, children: [] },
      ],
      currency: 'EUR',
      guestNationality: 'ES',
      margin: 3,
      limit: 20,
      maxRatesPerHotel: 1,
      includeHotelData: true,
    });
  });

  it('returns normalized offers and meters one successful search', async () => {
    const { fetchImpl } = replay('rates-city-porto');
    const { supplier, events } = adapter(fetchImpl);
    const result = await supplier.searchAvailability(PORTO);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offers).toHaveLength(20);
    expect(result.value.offers[0].fetchedAt).toBe(NOW);
    expect(result.value.offers[0].marginPct).toBe(3);
    expect(events).toEqual([
      { provider: 'liteapi:search', latencyMs: expect.any(Number), success: true, errorMessage: null, meta: { status: 200, hotels: 20, offers: 20 } },
    ]);
  });

  it('"no availability" arrives as an error body on HTTP 200 and is an empty result', async () => {
    const { fetchImpl } = replay('rates-no-availability');
    const { supplier, events } = adapter(fetchImpl);
    expect(await supplier.searchAvailability(PORTO)).toEqual({ ok: true, value: { properties: [], offers: [] } });
    expect(events[0]).toMatchObject({ success: true, meta: { hotels: 0, offers: 0 } });
  });

  it('a supplier validation error is a failure with its code and is not retryable', async () => {
    const { fetchImpl } = replay('rates-error-missing-nationality');
    const { supplier, events } = adapter(fetchImpl);
    expect(await supplier.searchAvailability(PORTO)).toEqual({
      ok: false,
      error: { kind: 'supplier', status: 400, code: 4002, message: 'guestNationality field invalid or missing', retryable: false },
    });
    expect(events[0]).toMatchObject({ provider: 'liteapi:search', success: false, errorMessage: 'guestNationality field invalid or missing' });
  });

  it('a response missing an offer id is a schema error that names the path, not the payload', async () => {
    const { fetchImpl } = replay('rates-city-porto', (body) => delete body.data[3].roomTypes[0].offerId);
    const { supplier } = adapter(fetchImpl);
    const result = await supplier.searchAvailability(PORTO);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'schema', status: 200, code: null, message: 'unexpected response shape at data.3.roomTypes.0.offerId: invalid_type', retryable: false },
    });
  });

  it('a price that is not a number is refused, not coerced', async () => {
    const { fetchImpl } = replay('rates-city-porto', (body) => {
      body.data[0].roomTypes[0].offerRetailRate.amount = '158.04' as unknown as Loose;
    });
    const { supplier } = adapter(fetchImpl);
    const result = await supplier.searchAvailability(PORTO);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'schema', message: expect.stringContaining('offerRetailRate.amount') });
  });
});

describe('transport failures', () => {
  it('a timeout is retryable and says how long it waited', async () => {
    vi.useFakeTimers();
    try {
      const hanging: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      const { supplier, events } = adapter(hanging);
      const pending = supplier.searchPlaces('Porto');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({
        ok: false,
        error: { kind: 'timeout', status: null, code: null, message: 'timed out after 10000 ms', retryable: true },
      });
      expect(events[0]).toMatchObject({ provider: 'liteapi:places', success: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a network error is retryable and its text carries neither the key nor the URL', async () => {
    const broken: FetchLike = async (url) => {
      throw new TypeError(`fetch failed for ${url} with key ${KEY}`);
    };
    const { supplier, events } = adapter(broken);
    const result = await supplier.searchPlaces('Porto');
    expect(result).toEqual({ ok: false, error: { kind: 'network', status: null, code: null, message: 'TypeError', retryable: true } });
    expect(JSON.stringify([result, events])).not.toContain(KEY);
    expect(JSON.stringify([result, events])).not.toContain('liteapi.travel');
  });

  it('an HTML error page is an HTTP failure; 503 is retryable, 403 is not', async () => {
    const page = (status: number): FetchLike => async () => new Response('<html>nope</html>', { status });
    expect(await adapter(page(503)).supplier.searchPlaces('x')).toEqual({
      ok: false,
      error: { kind: 'http', status: 503, code: null, message: 'HTTP 503', retryable: true },
    });
    expect(await adapter(page(403)).supplier.searchPlaces('x')).toMatchObject({ ok: false, error: { kind: 'http', retryable: false } });
  });

  it('a 200 that is not JSON is bad_json', async () => {
    const { supplier } = adapter(async () => new Response('ok', { status: 200 }));
    expect(await supplier.searchPlaces('x')).toMatchObject({ ok: false, error: { kind: 'bad_json', status: 200 } });
  });

  it('a failing usage meter is reported and does not lose the result', async () => {
    const { fetchImpl } = replay('places-porto-ribeira');
    const reported: unknown[] = [];
    const supplier = createLiteApiAdapter({
      apiKey: KEY,
      fetchImpl,
      meter: () => {
        throw new Error('ledger down');
      },
      onMeterError: (err) => reported.push(err),
    });
    const result = await supplier.searchPlaces('Ribeira Porto');
    expect(result.ok).toBe(true);
    expect(reported).toHaveLength(1);
  });
});

describe('places and static content', () => {
  it('encodes the query and returns places', async () => {
    const { fetchImpl, calls } = replay('places-porto-ribeira');
    const { supplier } = adapter(fetchImpl);
    const result = await supplier.searchPlaces('Ribeira Porto & more');
    expect(calls[0].url).toBe('https://api.liteapi.travel/v3.0/data/places?textQuery=Ribeira%20Porto%20%26%20more');
    expect(result.ok && result.value).toHaveLength(4);
  });

  it('fetches hotel details by id', async () => {
    const { fetchImpl, calls } = replay('hotel-details');
    const { supplier, events } = adapter(fetchImpl);
    const result = await supplier.getStaticContent('lp76a2a');
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.liteapi.travel/v3.0/data/hotel?hotelId=lp76a2a' });
    expect(result.ok && result.value.name).toBe('Vincci Porto');
    expect(events[0].provider).toBe('liteapi:content');
  });
});

describe('recheckRate, book, getBooking, cancel', () => {
  it('prebooks with the payment SDK and returns the price to compare', async () => {
    const { fetchImpl, calls } = replay('prebook-payment-sdk');
    const { supplier, events } = adapter(fetchImpl);
    const result = await supplier.recheckRate('opaque-offer-id==');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://book.liteapi.travel/v3.0/rates/prebook',
      body: { offerId: 'opaque-offer-id==', usePaymentSdk: true },
    });
    expect(result.ok && result.value.total).toEqual({ amountMinor: 18571, currency: 'EUR' });
    expect(result.ok && result.value.checkedAt).toBe(NOW);
    expect(events[0].provider).toBe('liteapi:prebook');
    // The client secret is for the payment form and must not reach the ledger.
    expect(JSON.stringify(events)).not.toContain('REDACTED_AT_CAPTURE');
  });

  it('an offer the supplier no longer knows is a supplier error', async () => {
    const { fetchImpl } = replay('prebook-error-invalid-offer');
    const { supplier } = adapter(fetchImpl);
    expect(await supplier.recheckRate('gone')).toEqual({
      ok: false,
      error: { kind: 'supplier', status: 400, code: 4002, message: 'invalid offerId', retryable: false },
    });
  });

  it('books with the transaction id only, one guest per room in order', async () => {
    const { fetchImpl, calls } = replay('book-confirmed');
    const { supplier, events } = adapter(fetchImpl);
    const holder = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
    const second = { firstName: 'Second', lastName: 'Guest', email: 'second@fixture.hotelfinder.invalid' };
    const result = await supplier.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder, guests: [holder, second] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://book.liteapi.travel/v3.0/rates/book',
      body: {
        prebookId: 'pre_1',
        holder,
        payment: { method: 'TRANSACTION_ID', transactionId: 'tr_1' },
        guests: [
          { occupancyNumber: 1, ...holder },
          { occupancyNumber: 2, ...second },
        ],
      },
    });
    expect(result.ok && result.value).toMatchObject({ supplierBookingId: 'yzAvfyYq5', status: 'confirmed' });
    expect(events[0]).toMatchObject({ provider: 'liteapi:book', success: true, meta: { status: 'CONFIRMED' } });
  });

  it('never retries book on its own: a timeout is one call and one failure', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const hanging: FetchLike = (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      };
      const { supplier } = adapter(hanging);
      const holder = { firstName: 'A', lastName: 'B', email: 'a@fixture.hotelfinder.invalid' };
      const pending = supplier.book({ prebookId: 'p', transactionId: 't', holder, guests: [holder] });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toMatchObject({ ok: false, error: { kind: 'timeout' } });
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a booking back and cancels it', async () => {
    const got = replay('booking-get');
    const a = adapter(got.fetchImpl);
    expect(await a.supplier.getBooking('yzAvfyYq5')).toMatchObject({ ok: true, value: { status: 'confirmed' } });
    expect(got.calls[0]).toMatchObject({ method: 'GET', url: 'https://book.liteapi.travel/v3.0/bookings/yzAvfyYq5' });

    const cancelled = replay('booking-cancel');
    const b = adapter(cancelled.fetchImpl);
    expect(await b.supplier.cancel('yzAvfyYq5')).toMatchObject({
      ok: true,
      value: { status: 'cancelled', refund: { amountMinor: 15804, currency: 'EUR' }, fee: { amountMinor: 0 } },
    });
    expect(cancelled.calls[0]).toMatchObject({ method: 'PUT', url: 'https://book.liteapi.travel/v3.0/bookings/yzAvfyYq5' });
    expect(b.events[0].provider).toBe('liteapi:cancel');
  });

  it('an unknown booking is a supplier error, 404', async () => {
    const { fetchImpl } = replay('booking-get-error-unknown');
    const { supplier } = adapter(fetchImpl);
    expect(await supplier.getBooking('nope')).toEqual({
      ok: false,
      error: { kind: 'supplier', status: 404, code: 4004, message: 'booking not found', retryable: false },
    });
  });
});

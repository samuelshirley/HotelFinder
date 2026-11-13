import { describe, expect, it, vi } from 'vitest';

import type { SearchRequest, SupplierMeterEvent } from '../types';
import { createLiteApiAdapter } from './adapter';
import { fixture, manifest, replay, type Loose } from './fixtures';
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

  it('a radius search sends a point and a radius in metres, and nothing else of ours', async () => {
    const { fetchImpl, calls } = replay('rates-radius-porto-airport');
    const { supplier } = adapter(fetchImpl);
    const result = await supplier.searchAvailability({ ...PORTO, where: { latitude: 41.2481, longitude: -8.6814, radiusM: 5000 } });
    expect(calls[0].body).toMatchObject({ latitude: 41.2481, longitude: -8.6814, radius: 5000 });
    expect(calls[0].body).not.toHaveProperty('radiusM');
    expect(calls[0].body).not.toHaveProperty('cityName');
    expect(result.ok && result.value.offers.length).toBe(20);
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
      {
        provider: 'liteapi:search',
        latencyMs: expect.any(Number),
        success: true,
        errorMessage: null,
        costMicrocents: 0,
        meta: { status: 200, hotels: 20, offers: 20, pricing: 'free', sandbox: true },
      },
    ]);
  });

  it('"no availability" arrives as an error body on HTTP 200 and is an empty result', async () => {
    const { fetchImpl } = replay('rates-no-availability');
    const { supplier, events } = adapter(fetchImpl);
    expect(await supplier.searchAvailability(PORTO)).toEqual({ ok: true, value: { properties: [], offers: [] } });
    expect(events[0]).toMatchObject({ success: true, meta: { hotels: 0, offers: 0 } });
  });

  it('prices in the currency asked for: every total, fee and penalty comes back in it, converted by the supplier', async () => {
    const { fetchImpl, calls } = replay('rates-city-porto-usd');
    const { supplier } = adapter(fetchImpl);
    const result = await supplier.searchAvailability({ ...PORTO, currency: 'USD' });
    expect(calls[0].body).toMatchObject({ currency: 'USD' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offers).toHaveLength(20);
    for (const o of result.value.offers) {
      expect(o.total.currency).toBe('USD');
      expect(o.payAtProperty.currency).toBe('USD');
      expect(o.hasForeignCurrencyFees).toBe(false);
      for (const f of o.fees) expect(f.amount.currency).toBe('USD');
      for (const p of o.cancellation.penalties) expect(p.amount.currency).toBe('USD');
    }
  });

  it('an unknown currency is not refused: the supplier says "no availability" (why only recorded codes are sent)', async () => {
    const { fetchImpl } = replay('rates-currency-unknown');
    const { supplier } = adapter(fetchImpl);
    expect(await supplier.searchAvailability({ ...PORTO, currency: 'XQZ' })).toEqual({ ok: true, value: { properties: [], offers: [] } });
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

  it('meters a place search at its list price, on success and on failure (src/lib/supplierPrices.ts)', async () => {
    const ok = adapter(replay('places-porto').fetchImpl);
    expect((await ok.supplier.searchPlaces('Porto')).ok).toBe(true);
    expect(ok.events).toEqual([expect.objectContaining({ provider: 'liteapi:places', success: true, costMicrocents: 1_000_000, meta: expect.objectContaining({ pricing: 'per_call', sandbox: true }) })]);

    const refused = adapter(async () => new Response('<html>nope</html>', { status: 503 }));
    await refused.supplier.searchPlaces('Porto');
    expect(refused.events).toEqual([expect.objectContaining({ provider: 'liteapi:places', success: false, costMicrocents: 1_000_000, meta: expect.objectContaining({ pricing: 'per_call' }) })]);
  });

  it('a production key is marked as not sandbox', async () => {
    const events: SupplierMeterEvent[] = [];
    const prod = createLiteApiAdapter({ apiKey: 'prod_not-real', fetchImpl: replay('places-porto').fetchImpl, now: () => NOW, meter: (e) => void events.push(e) });
    await prod.searchPlaces('Porto');
    expect(events[0].meta).toMatchObject({ pricing: 'per_call', sandbox: false });
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

  it('fetches a place\'s map point and kind by id, and meters it', async () => {
    const { fetchImpl, calls } = replay('place-annecy');
    const { supplier, events } = adapter(fetchImpl);
    const result = await supplier.getPlace('ChIJ/opaque id');
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.liteapi.travel/v3.0/data/places/ChIJ%2Fopaque%20id' });
    expect(result).toEqual({
      ok: true,
      value: { placeId: 'ChIJ/opaque id', name: 'Annecy', latitude: expect.closeTo(45.9059, 3), longitude: expect.closeTo(6.1259, 3), types: expect.arrayContaining(['locality']), countryCode: 'FR' },
    });
    expect(events[0].provider).toBe('liteapi:place');
  });

  it('an airport is a place like any other, with its own types', async () => {
    const { fetchImpl } = replay('place-barcelona-airport');
    const result = await adapter(fetchImpl).supplier.getPlace('x');
    expect(result.ok && result.value.types).toContain('airport');
    expect(result.ok && result.value.countryCode).toBe('ES');
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

describe('the language for place names and hotel text', () => {
  const inSpanish = (fetchImpl: FetchLike) => createLiteApiAdapter({ apiKey: KEY, fetchImpl, now: () => NOW, language: 'es' });

  it('asks for places, a place and a hotel in it (measured on the sandbox: "Londres", Spanish descriptions)', async () => {
    const places = replay('places-porto-ribeira');
    await inSpanish(places.fetchImpl).searchPlaces('Oporto');
    expect(places.calls[0].url).toBe('https://api.liteapi.travel/v3.0/data/places?textQuery=Oporto&language=es');
    const place = replay('place-annecy');
    await inSpanish(place.fetchImpl).getPlace('abc');
    expect(place.calls[0].url).toBe('https://api.liteapi.travel/v3.0/data/places/abc?language=es');
    const hotel = replay('hotel-details');
    await inSpanish(hotel.fetchImpl).getStaticContent('lp76a2a');
    expect(hotel.calls[0].url).toBe('https://api.liteapi.travel/v3.0/data/hotel?hotelId=lp76a2a&language=es');
  });

  it('never on rates or facts, and English is the supplier default: no parameter', async () => {
    const search = replay('rates-city-porto');
    await inSpanish(search.fetchImpl).searchAvailability(PORTO);
    expect(search.calls[0].url).not.toContain('language');
    const english = replay('hotel-details');
    await createLiteApiAdapter({ apiKey: KEY, fetchImpl: english.fetchImpl, now: () => NOW, language: 'en' }).getStaticContent('lp76a2a');
    expect(english.calls[0].url).toBe('https://api.liteapi.travel/v3.0/data/hotel?hotelId=lp76a2a');
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

  it('a two-room prebook says which rooms it holds and for whom, in occupancy order; a rate that does not say leaves them unknown', async () => {
    const { supplier } = adapter(replay('prebook-mixed-rooms').fetchImpl);
    const result = await supplier.recheckRate('opaque');
    expect(result.ok && result.value.rooms).toEqual([
      { name: 'Vincci Room', boardName: 'Room Only', adults: 2, childrenAges: [] },
      { name: 'Vincci Room Uso Individual', boardName: 'Room Only', adults: 1, childrenAges: [] },
    ]);
    const one = await adapter(replay('prebook-payment-sdk').fetchImpl).supplier.recheckRate('opaque');
    expect(one.ok && one.value.rooms).toHaveLength(1);
    // One rate without its party: none of the rooms are claimed (derived in memory; the file is untouched).
    const half = replay('prebook-mixed-rooms', (body) => {
      delete (body.data.roomTypes[0].rates[1] as unknown as Record<string, unknown>).adultCount;
    });
    const unknown = await adapter(half.fetchImpl).supplier.recheckRate('opaque');
    expect(unknown.ok && unknown.value.rooms).toEqual([]);
  });

  it('two different rooms book as ONE booking: the recorded sandbox booking of a two-room offer', async () => {
    const { fetchImpl, calls } = replay('book-mixed-rooms');
    const { supplier } = adapter(fetchImpl);
    const a = { firstName: 'Fixture', lastName: 'Guest1', email: 'guest1@fixture.hotelfinder.invalid' };
    const b = { firstName: 'Fixture', lastName: 'Guest2', email: 'guest2@fixture.hotelfinder.invalid' };
    const result = await supplier.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder: a, guests: [a, b], payment: 'sandbox_test' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ guests: [{ occupancyNumber: 1, ...a }, { occupancyNumber: 2, ...b }] });
    expect(result).toMatchObject({ ok: true, value: { status: 'confirmed', supplierBookingId: 'hMt2HdnXq', total: { amountMinor: 36346, currency: 'EUR' } } });
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
    const result = await supplier.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder, guests: [holder, second], payment: 'transaction_id' });
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

  it('a special request goes to the hotel as every room’s remarks, and never into the ledger', async () => {
    const { fetchImpl, calls } = replay('book-with-remarks');
    const { supplier, events } = adapter(fetchImpl);
    const holder = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
    const request = 'A quiet room on a high floor, if possible.';
    const result = await supplier.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder, guests: [holder, holder], payment: 'transaction_id', specialRequest: request });
    expect(result).toMatchObject({ ok: true, value: { status: 'confirmed' } });
    expect((calls[0].body as { guests: unknown[] }).guests).toEqual([
      { occupancyNumber: 1, ...holder, remarks: request },
      { occupancyNumber: 2, ...holder, remarks: request },
    ]);
    expect(JSON.stringify(events)).not.toContain('quiet room');
  });

  it('no special request sends no remarks at all', async () => {
    for (const specialRequest of [undefined, null, '']) {
      const { fetchImpl, calls } = replay('book-confirmed');
      const holder = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
      await adapter(fetchImpl).supplier.book({ prebookId: 'p', transactionId: 't', holder, guests: [holder], payment: 'transaction_id', specialRequest });
      expect((calls[0].body as { guests: object[] }).guests[0]).not.toHaveProperty('remarks');
    }
  });

  it('the sandbox keeps a request sent in guests[].remarks: the booking read back carries it', () => {
    const sent = (manifest.files['book-with-remarks.json'].request as { guests: Array<{ remarks: string }> }).guests[0].remarks;
    expect(sent.length).toBeGreaterThan(0);
    const booked = fixture('book-with-remarks').data;
    const readBack = fixture('booking-get-with-remarks').data;
    expect(String(booked.status)).toBe('CONFIRMED');
    expect(String(readBack.remarks)).toBe(sent);
    expect(String(readBack.bookedRooms[0].guests[0].remarks)).toBe(sent);
    expect(String(fixture('booking-cancel-with-remarks').data.status)).toBe('CANCELLED');
  });

  it('a test payment books with the sandbox card method, and only with a sandbox key', async () => {
    const holder = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
    const sandbox = replay('book-confirmed');
    const sb = createLiteApiAdapter({ apiKey: 'sand_fixture', fetchImpl: sandbox.fetchImpl });
    expect(await sb.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder, guests: [holder], payment: 'sandbox_test' })).toMatchObject({ ok: true });
    expect(sandbox.calls[0].body).toMatchObject({ payment: { method: 'ACC_CREDIT_CARD' } });

    const liveCalls = replay('book-confirmed');
    const live = createLiteApiAdapter({ apiKey: 'prod_fixture', fetchImpl: liveCalls.fetchImpl });
    expect(await live.book({ prebookId: 'pre_1', transactionId: 'tr_1', holder, guests: [holder], payment: 'sandbox_test' })).toMatchObject({
      ok: false,
      error: { kind: 'supplier', message: 'a test payment needs a sandbox key', retryable: false },
    });
    expect(liveCalls.calls).toHaveLength(0);
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
      const pending = supplier.book({ prebookId: 'p', transactionId: 't', holder, guests: [holder], payment: 'transaction_id' });
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

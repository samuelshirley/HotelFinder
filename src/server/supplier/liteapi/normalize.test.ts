import { describe, expect, it } from 'vitest';

import { mergeFees, payAtHotelCharges } from '@/lib/checkout';

import { fixture } from './fixtures';
import {
  bookingStatus,
  normalizeBooking,
  normalizeCancel,
  normalizeCancellation,
  normalizeDetails,
  normalizePlaces,
  normalizePrebook,
  normalizeRates,
  supplierTimeToIso,
} from './normalize';
import {
  bookingResponse,
  cancelResponse,
  hotelDetailsResponse,
  placesResponse,
  prebookResponse,
  ratesResponse,
} from './schemas';

const AT = new Date('2026-11-11T12:00:00Z');

describe('rates → offers (recorded Porto search, 2 adults, 11–13 Dec 2026)', () => {
  const raw = fixture('rates-city-porto');
  const result = normalizeRates(ratesResponse.parse(raw), 0, AT);

  it('produces one offer per room type and one property per hotel', () => {
    expect(result.offers).toHaveLength(20);
    expect(result.properties).toHaveLength(20);
    expect(new Set(result.offers.map((o) => o.supplierHotelId)).size).toBe(20);
  });

  it('every offer has a property to hang on', () => {
    const known = new Set(result.properties.map((p) => p.supplierHotelId));
    for (const o of result.offers) expect(known.has(o.supplierHotelId)).toBe(true);
  });

  it('forwards the supplier offer id byte for byte', () => {
    const rawId = ratesResponse.parse(raw).data[0].roomTypes[0].offerId;
    expect(rawId.length).toBe(1128);
    expect(result.offers[0].supplierOfferId).toBe(rawId);
  });

  it('reads the first offer: total, suggested price, the tax paid at the desk', () => {
    const first = result.offers[0];
    expect(first).toMatchObject({
      supplier: 'liteapi',
      supplierHotelId: 'lp76a2a',
      total: { amountMinor: 15804, currency: 'EUR' },
      suggestedSelling: { amountMinor: 18269, currency: 'EUR' },
      payAtProperty: { amountMinor: 1200, currency: 'EUR' },
      hasForeignCurrencyFees: false,
      commission: { amountMinor: 0, currency: 'EUR' },
      marginPct: 0,
      rooms: [{ name: 'Vincci Room', boardName: 'Room Only', adults: 2, childrenAges: [] }],
    });
    expect(first.fees).toEqual([{ description: 'CITY_TAX', amount: { amountMinor: 1200, currency: 'EUR' }, included: false }]);
    expect(first.fetchedAt).toBe(AT);
  });

  it('reads the matching property from the brief', () => {
    expect(result.properties.find((p) => p.supplierHotelId === 'lp76a2a')).toEqual({
      supplier: 'liteapi',
      supplierHotelId: 'lp76a2a',
      name: 'Vincci Porto',
      latitude: 41.147002,
      longitude: -8.632235,
      stars: 4,
      rating: 8.8,
      reviewCount: 6127,
      mainPhoto: 'https://static.cupid.travel/hotels/44486934.jpg',
      address: 'Rua Alameda Basilio Teles, 26 / 33',
    });
  });

  it('a refundable offer is free to cancel until the first charging penalty, in UTC', () => {
    const c = result.offers[0].cancellation;
    expect(c).toMatchObject({ tag: 'RFN', refundable: true, freeCancellationUntil: '2026-11-25T09:59:00.000Z' });
    expect(c.penalties).toEqual([
      {
        from: '2026-11-25T09:59:00.000Z',
        fromRaw: '2026-11-25 09:59:00',
        timezone: 'GMT',
        amount: { amountMinor: 15804, currency: 'EUR' },
        type: 'amount',
      },
    ]);
  });

  it('a non-refundable offer has no free-cancellation deadline', () => {
    const refundable = result.offers.filter((o) => o.cancellation.refundable);
    const non = result.offers.filter((o) => !o.cancellation.refundable);
    expect(refundable).toHaveLength(4);
    expect(non).toHaveLength(16);
    for (const o of non) expect(o.cancellation.freeCancellationUntil).toBeNull();
  });

  it('pay-at-property is exactly the sum of the charges marked not included', () => {
    for (const hotel of ratesResponse.parse(raw).data) {
      for (const rt of hotel.roomTypes) {
        const expected = Math.round(
          rt.rates
            .flatMap((r) => r.retailRate.taxesAndFees ?? [])
            .filter((f) => !f.included)
            .reduce((sum, f) => sum + f.amount, 0) * 100,
        );
        const offer = result.offers.find((o) => o.supplierOfferId === rt.offerId)!;
        expect(offer.payAtProperty.amountMinor).toBe(expected);
        expect(offer.total.amountMinor).toBe(Math.round(rt.offerRetailRate.amount * 100));
      }
    }
  });

  it('carries the margin the search was made with', () => {
    expect(normalizeRates(ratesResponse.parse(raw), 7.5, AT).offers.every((o) => o.marginPct === 7.5)).toBe(true);
  });
});

describe('rates → offers (recorded family search: two rooms, children aged 4 and 9)', () => {
  const result = normalizeRates(ratesResponse.parse(fixture('rates-family-two-rooms')), 0, AT);
  const offer = result.offers.find((o) => o.supplierHotelId === 'lp1f67a6')!;

  it('one offer covers both rooms and its total is the whole stay', () => {
    expect(offer.total).toEqual({ amountMinor: 68732, currency: 'EUR' });
    expect(offer.rooms.map((r) => [r.adults, r.childrenAges])).toEqual([
      [2, [4, 9]],
      [2, []],
    ]);
  });

  it('adds the city tax of both rooms and keeps included VAT out of it', () => {
    expect(offer.payAtProperty).toEqual({ amountMinor: 3600, currency: 'EUR' });
    expect(offer.fees.filter((f) => f.included).map((f) => f.description)).toEqual(['VAT', 'VAT']);
  });
});

describe('rooms with different cancellation terms', () => {
  // Derived in memory from the recorded two-room offer: the second room is
  // made non-refundable, the first refundable with a deadline.
  function mixed(first: 'RFN' | 'NRFN', second: 'RFN' | 'NRFN') {
    const body = ratesResponse.parse(fixture('rates-family-two-rooms'));
    const rates = body.data.find((h) => h.hotelId === 'lp1f67a6')!.roomTypes[0].rates;
    const penalty = (time: string) => [{ cancelTime: time, amount: 100, currency: 'EUR', type: 'amount', timezone: 'GMT' }];
    rates[0].cancellationPolicies = { refundableTag: first, cancelPolicyInfos: first === 'RFN' ? penalty('2026-12-05 12:00:00') : [] };
    rates[1].cancellationPolicies = { refundableTag: second, cancelPolicyInfos: second === 'RFN' ? penalty('2026-12-01 12:00:00') : [] };
    return normalizeRates(body, 0, AT).offers.find((o) => o.supplierHotelId === 'lp1f67a6')!.cancellation;
  }

  it('one non-refundable room makes the whole offer non-refundable', () => {
    expect(mixed('RFN', 'NRFN')).toMatchObject({ refundable: false, tag: 'NRFN', freeCancellationUntil: null });
    expect(mixed('NRFN', 'RFN')).toMatchObject({ refundable: false, freeCancellationUntil: null });
  });

  it('two refundable rooms are free only until the earlier deadline', () => {
    expect(mixed('RFN', 'RFN')).toMatchObject({ refundable: true, freeCancellationUntil: '2026-12-01T12:00:00.000Z' });
  });
});

describe('two rooms of one offer: fees and cancellation charges are for both rooms (recorded 4 adults, 2 rooms)', () => {
  const body = () => ratesResponse.parse(fixture('rates-four-adults-two-rooms'));
  const offers = normalizeRates(body(), 0, AT).offers.filter((o) => o.supplierHotelId === 'lp76a2a' && o.rooms.length === 2);
  const refundable = offers.find((o) => o.cancellation.refundable && o.total.amountMinor === 36754)!;

  it('the city tax of each room is listed once per room, and named once when shown (bug 2026-11-14)', () => {
    expect(refundable.fees.filter((f) => !f.included).map((f) => f.description)).toEqual(['CITY_TAX', 'CITY_TAX']);
    const shown = payAtHotelCharges(mergeFees(refundable.fees.map((f) => ({ description: f.description, ...f.amount, included: f.included }))));
    expect(shown).toEqual([{ description: 'CITY_TAX', amountMinor: refundable.payAtProperty.amountMinor, currency: 'EUR' }]);
    expect(refundable.payAtProperty).toEqual({ amountMinor: 2400, currency: 'EUR' });
  });

  it('cancelling costs what both rooms cost, once per moment, not one room per line', () => {
    // Each room: 183.77 from 2026-11-25 09:59 GMT. The offer is 367.54 for both.
    expect(refundable.cancellation.penalties.map((p) => [p.from, p.amount.amountMinor])).toEqual([['2026-11-25T09:59:00.000Z', 36754]]);
    expect(refundable.cancellation.freeCancellationUntil).toBe('2026-11-25T09:59:00.000Z');
  });

  it('rooms charging from different moments: each moment charges every room already charging then', () => {
    const b = body();
    const rates = b.data.find((h) => h.hotelId === 'lp76a2a')!.roomTypes.find((rt) => rt.offerRetailRate.amount === 367.54)!.rates;
    const at = (cancelTime: string, amount: number) => ({ cancelTime, amount, currency: 'EUR', type: 'amount', timezone: 'GMT' });
    rates[0].cancellationPolicies = { refundableTag: 'RFN', cancelPolicyInfos: [at('2026-12-01 12:00:00', 50), at('2026-12-08 12:00:00', 100)] };
    rates[1].cancellationPolicies = { refundableTag: 'RFN', cancelPolicyInfos: [at('2026-12-05 12:00:00', 80)] };
    const c = normalizeRates(b, 0, AT).offers.find((o) => o.supplierOfferId === refundable.supplierOfferId)!.cancellation;
    expect(c.penalties.map((p) => [p.from, p.amount.amountMinor])).toEqual([
      ['2026-12-01T12:00:00.000Z', 5000],
      ['2026-12-05T12:00:00.000Z', 13000],
      ['2026-12-08T12:00:00.000Z', 18000],
    ]);
    expect(c.freeCancellationUntil).toBe('2026-12-01T12:00:00.000Z');
  });
});

describe('cancellation time zones', () => {
  it('converts GMT and UTC and nothing else', () => {
    expect(supplierTimeToIso('2026-11-25 09:59:00', 'GMT')).toBe('2026-11-25T09:59:00.000Z');
    expect(supplierTimeToIso('2026-11-25 09:59:00', 'utc')).toBe('2026-11-25T09:59:00.000Z');
    expect(supplierTimeToIso('2026-11-25 09:59:00', 'Europe/Lisbon')).toBeNull();
    expect(supplierTimeToIso('2026-11-25 09:59:00', null)).toBeNull();
    expect(supplierTimeToIso('25/11/2026', 'GMT')).toBeNull();
  });

  it('refuses to state a deadline it could not convert', () => {
    const policy = normalizeCancellation(
      {
        refundableTag: 'RFN',
        cancelPolicyInfos: [{ cancelTime: '2026-11-25 09:59:00', amount: 100, currency: 'EUR', type: 'amount', timezone: 'CET' }],
      },
      'EUR',
    );
    expect(policy.refundable).toBe(true);
    expect(policy.freeCancellationUntil).toBeNull();
    expect(policy.penalties[0]).toMatchObject({ from: null, fromRaw: '2026-11-25 09:59:00', timezone: 'CET' });
  });
});

describe('the rest of the recorded responses', () => {
  it('places', () => {
    const places = normalizePlaces(placesResponse.parse(fixture('places-porto-ribeira')));
    expect(places).toHaveLength(4);
    expect(places[0]).toEqual({
      placeId: 'ChIJicetJOdkJA0R8GJ9Dy_dcgo',
      name: 'Ribeira',
      address: 'Porto, Portugal',
      types: ['geocode', 'neighborhood', 'political'],
    });
  });

  it('hotel details', () => {
    const d = normalizeDetails(hotelDetailsResponse.parse(fixture('hotel-details')));
    expect(d).toMatchObject({
      supplierHotelId: 'lp76a2a',
      name: 'Vincci Porto',
      petsAllowed: null, // a false flag alone is "not stated": pets.test.ts
      parking: 'PAID',
      childrenAllowed: true,
      stars: 4,
      rating: 8.8,
      reviewCount: 6127,
      latitude: 41.147002,
      longitude: -8.632235,
    });
    expect(d.facilities).toHaveLength(59);
    expect(d.facilities.slice(0, 3)).toEqual(['WiFi available', 'Free WiFi', 'Parking']);
    expect(d.imageUrls).toHaveLength(42);
    expect(d.importantInformation).toMatch(/^Upon arrival, guests must present the credit card/);
  });

  it('prebook', () => {
    const check = normalizePrebook(prebookResponse.parse(fixture('prebook-payment-sdk')), AT);
    expect(check).toMatchObject({
      prebookId: 'r12JWriF-',
      transactionId: 'tr_cts_NPk9mfD3oz3BIShGdNrqG',
      clientSecret: 'REDACTED_AT_CAPTURE',
      supplierHotelId: 'lp55362',
      total: { amountMinor: 18571, currency: 'EUR' },
      suggestedSelling: { amountMinor: 19890, currency: 'EUR' },
      cancellationChanged: false,
      boardChanged: false,
      checkedAt: AT,
    });
    expect(check.cancellation).toMatchObject({ tag: 'NRFN', refundable: false, freeCancellationUntil: null });
  });

  it('a confirmed booking, read back, then cancelled', () => {
    const booked = normalizeBooking(bookingResponse.parse(fixture('book-confirmed')));
    expect(booked).toMatchObject({
      supplierBookingId: 'yzAvfyYq5',
      status: 'confirmed',
      statusRaw: 'CONFIRMED',
      hotelConfirmationCode: 'test',
      supplierHotelId: 'lp76a2a',
      hotelName: 'Vincci Porto',
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      total: { amountMinor: 15804, currency: 'EUR' },
      cancelledAt: null,
    });
    expect(booked.cancellation?.freeCancellationUntil).toBe('2026-11-25T09:59:00.000Z');

    expect(normalizeBooking(bookingResponse.parse(fixture('booking-get'))).status).toBe('confirmed');
    expect(normalizeCancel(cancelResponse.parse(fixture('booking-cancel')))).toEqual({
      supplierBookingId: 'yzAvfyYq5',
      status: 'cancelled',
      statusRaw: 'CANCELLED',
      fee: { amountMinor: 0, currency: 'EUR' },
      refund: { amountMinor: 15804, currency: 'EUR' },
    });
    expect(normalizeBooking(bookingResponse.parse(fixture('booking-get-after-cancel')))).toMatchObject({
      status: 'cancelled',
      cancelledAt: '2026-11-11T12:15:56Z',
    });
  });

  it('hotel details: check-in times, the review summary and the rooms, as the supplier gives them', () => {
    const d = normalizeDetails(hotelDetailsResponse.parse(fixture('hotel-details')));
    expect(d).toMatchObject({ checkInFrom: '03:00 PM', checkOutUntil: '12:00 PM' });
    expect(d.reviews?.pros).toHaveLength(6);
    expect(d.reviews?.categories[0]).toMatchObject({ name: 'Cleanliness', rating: 8.8 });
    expect(d.rooms[0]).toMatchObject({ name: 'Vincci Room', sizeSqm: 22, beds: ['2 × twin bed', 'double bed'], maxOccupancy: 2 });
    expect(d.rooms[0].photo).toMatch(/^https:\/\//);
  });

  it('a non-refundable cancel is still a cancel: the supplier keeps the price as the fee', () => {
    expect(normalizeCancel(cancelResponse.parse(fixture('booking-cancel-with-charges')))).toEqual({
      supplierBookingId: '2U0GzrbQp',
      status: 'cancelled',
      statusRaw: 'CANCELLED_WITH_CHARGES',
      fee: { amountMinor: 18465, currency: 'EUR' },
      refund: { amountMinor: 0, currency: 'EUR' },
    });
  });

  it('an unknown booking status is "other", never guessed', () => {
    expect(bookingStatus('CONFIRMED')).toBe('confirmed');
    expect(bookingStatus('cancelled')).toBe('cancelled');
    expect(bookingStatus('PENDING')).toBe('other');
    expect(bookingStatus('')).toBe('other');
  });

  it('evidence: the sandbox booked the same prebook twice', () => {
    const first = bookingResponse.parse(fixture('book-confirmed')).data;
    const again = bookingResponse.parse(fixture('book-same-prebook-again')).data;
    expect(again.status).toBe('CONFIRMED');
    expect(again.prebookId).toBe(first.prebookId);
    expect(again.bookingId).not.toBe(first.bookingId);
  });
});

/** Every key anywhere in a recorded body. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  return out;
}

describe('evidence for the checkout (docs/supplier.md, "Checkout extras")', () => {
  it('a prebook carries no expiry: not in the prebook, not in the prebook read back', () => {
    for (const name of ['prebook-checkout-extras', 'prebook-get', 'prebook-payment-sdk', 'prebook-for-booking', 'prebook-nonrefundable']) {
      const keys = keysOf(fixture(name));
      expect(keys.length, name).toBeGreaterThan(40);
      expect(
        keys.filter((k) => /expir|ttl|valid|hold|lock|deadline|until/i.test(k)),
        name,
      ).toEqual([]);
    }
    expect(normalizePrebook(prebookResponse.parse(fixture('prebook-checkout-extras')), AT)).toMatchObject({ total: { amountMinor: 14384, currency: 'EUR' } });
  });

  it('no rate in a 30-hotel search is pay-later or paid at the property: every one is "now", by the supplier’s own payment', () => {
    const raw = fixture('rates-city-porto-payment-types');
    const roomTypes = keysOf(raw).filter((k) => k === 'paymentSchedule').length;
    const text = JSON.stringify(raw);
    expect(roomTypes).toBeGreaterThan(100);
    expect([...new Set(text.match(/"paymentSchedule":"[^"]*"/g))]).toEqual(['"paymentSchedule":"now"']);
    expect(text).not.toMatch(/PROPERTY_PAY|CREDIT_CARD_SCHEDULED|"later"/);
    // What is paid at the hotel is the charges marked not included, and the schema still reads this search.
    const result = normalizeRates(ratesResponse.parse(raw), 0, AT);
    expect(result.offers.length).toBe(roomTypes);
    expect(result.offers.some((o) => o.payAtProperty.amountMinor > 0)).toBe(true);
  });
});

import { expect, stranger, test } from '../fixtures/test';
import { Api, expectError, json } from '../support/api';
import { uniqueEmail } from '../support/env';
import * as S from '../support/schemas';

/**
 * Booking (docs/architecture.md §10, invariants 7, 8 and 19): Book re-checks
 * the rate and writes the booking before any payment; one confirm checks the
 * code, signs in, takes the TEST payment and books in the sandbox; a booking
 * is cancelled through the supplier. Every booking made here is cancelled.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

test.describe('POST /api/session/[id]/checkout', { tag: ['@api', '@booking'] }, () => {
  test('re-checks the rate and returns a booking still to pay, at the price re-checked', async ({ api, prebooked }) => {
    const b = prebooked.booking;
    const row = prebooked.view.shortlist.find((r) => r.offer)!;
    expect(b).toMatchObject({ status: 'prebooked', sessionId: prebooked.sessionId, hotelName: row.property.name, priceCheckStale: false, reference: null, holder: null, paidWith: null });
    expect(b.checkIn).toBe(prebooked.view.stay!.checkIn);
    // A changed rate is shown, never absorbed (invariant 8): the old total is kept to compare.
    if (b.currency === row.offer!.currency) expect(b.quotedTotalMinor).toBe(row.offer!.totalMinor);
    expect(b.priceChanged).toBe(b.quotedTotalMinor !== b.totalMinor);
    void api;
  });

  test('an offer that is not this search\'s is property_not_found; a malformed one invalid_request', async ({ api, searched, visitor, ip }) => {
    await expectError(await api.checkout(searched.sessionId, { offerId: UNKNOWN }), 404, 'property_not_found');
    await expectError(await api.checkout(searched.sessionId, { offerId: 'nope' }), 400, 'invalid_request');
    await expectError(await api.checkout(searched.sessionId, {}), 400, 'invalid_request');
    // Another visitor's offer, in my search: not mine to book.
    const other = await stranger(ip);
    const theirs = await new Api(other).search();
    const offer = theirs.view.shortlist.find((r) => r.offer)!.offer!.id;
    await expectError(await visitor.api().checkout(searched.sessionId, { offerId: offer }), 404, 'property_not_found');
    // …and my offer in their search, by them.
    await expectError(await other.post(`api/session/${searched.sessionId}/checkout`, { data: { offerId: searched.view.shortlist[0].offer!.id } }), 404, 'session_not_found');
    await other.dispose();
  });
});

test.describe('GET /api/booking/[id]', { tag: ['@api', '@booking'] }, () => {
  test('the checkout page\'s data: the booking, nobody signed in, test payments', async ({ api, prebooked }) => {
    const page = await json(await api.booking(prebooked.bookingId), S.bookingPageBody);
    expect(page).toMatchObject({ me: null, lastHolder: null, payment: 'test' });
    expect(page.booking.id).toBe(prebooked.bookingId);
  });

  test('another visitor, an unknown id, or a malformed one: 404 booking_not_found', async ({ api, prebooked, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.get(`api/booking/${prebooked.bookingId}`), 404, 'booking_not_found');
    await other.dispose();
    await expectError(await api.booking(UNKNOWN), 404, 'booking_not_found');
    for (const id of ['not-a-uuid', 'a'.repeat(36)]) {
      const res = await api.booking(id);
      if (res.status() === 500) expect((await res.json()).ref, 'a 500 carries its ref').toMatch(/^[0-9a-f]{8}$/);
      await expectError(res, 404, 'booking_not_found');
    }
  });
});

test.describe('POST /api/booking/[id]/confirm', { tag: ['@api', '@booking'] }, () => {
  test('refusals before any payment, each with its code; the booking is still to pay after all of them', async ({ api, prebooked }) => {
    const id = prebooked.bookingId;
    const total = prebooked.booking.totalMinor;
    const email = uniqueEmail('confirm');
    const code = await api.sendCode(email);
    const base = { email, code, firstName: 'Ana', lastName: 'Silva', wallet: 'apple_pay', acceptedTotalMinor: total };
    await expectError(await api.confirm(id, { ...base, acceptedTotalMinor: total + 1 }), 409, 'price_changed');
    await expectError(await api.confirm(id, { ...base, firstName: '' }), 400, 'name_missing');
    await expectError(await api.confirm(id, { ...base, lastName: '1234' }), 400, 'name_missing');
    await expectError(await api.confirm(id, { ...base, email: 'nope' }), 400, 'email_invalid');
    await expectError(await api.confirm(id, { ...base, code: code === '000000' ? '111111' : '000000' }), 400, 'code_wrong');
    await expectError(await api.confirm(id, { ...base, wallet: 'paypal' }), 400, 'invalid_request');
    await expectError(await api.confirm(id, { ...base, acceptedTotalMinor: -1 }), 400, 'invalid_request');
    await expectError(await api.confirm(id, { ...base, card: '4242424242424242' }), 400, 'invalid_request');
    const { booking } = await json(await api.booking(id), S.bookingPageBody);
    expect(booking.status).toBe('prebooked');
    expect((await json(await api.me(), S.meBody)).user).toBeNull();
  });

  test('the right code books, signs in, and remembers the guest; a second confirm is booking_not_payable', async ({ api, booked }) => {
    const b = booked.booking;
    expect(b).toMatchObject({ status: 'confirmed', paidWith: 'google_pay', testPayment: true, holder: { firstName: 'Ana', lastName: 'Silva', email: booked.email.toLowerCase() } });
    expect(b.reference).toMatch(/\S{4,}/);
    // Signed in by the code, and the names come back next time.
    expect(await json(await api.me(), S.meBody)).toEqual({ user: { email: booked.email.toLowerCase() }, lastHolder: { firstName: 'Ana', lastName: 'Silva' } });
    await expectError(await api.confirm(booked.bookingId, { email: booked.email, code: '', firstName: 'Ana', lastName: 'Silva', wallet: 'google_pay', acceptedTotalMinor: b.totalMinor }), 409, 'booking_not_payable');
    // Card data never reaches the server (invariant 19): nothing card-like in what it keeps.
    expect(JSON.stringify(b)).not.toMatch(/\b\d{13,19}\b/);
  });

  test('another visitor cannot pay for it: 404 booking_not_found', async ({ prebooked, ip }) => {
    const other = await stranger(ip);
    await expectError(
      await other.post(`api/booking/${prebooked.bookingId}/confirm`, { data: { email: uniqueEmail('x'), code: '123456', firstName: 'A', lastName: 'B', wallet: 'apple_pay', acceptedTotalMinor: prebooked.booking.totalMinor } }),
      404,
      'booking_not_found',
    );
    await other.dispose();
  });
});

test.describe('POST /api/booking/[id]/cancel', { tag: ['@api', '@booking'] }, () => {
  test('a booking still to pay is not_cancellable (409)', async ({ api, prebooked }) => {
    await expectError(await api.cancel(prebooked.bookingId), 409, 'not_cancellable');
  });

  test('cancels through the supplier: cancelled, with the refund; a second cancel is not_cancellable', async ({ api, booked }) => {
    const { booking } = await json(await api.cancel(booked.bookingId), S.bookingBody);
    expect(booking.status).toBe('cancelled');
    expect(booking.reference).toBe(booked.booking.reference);
    await expectError(await api.cancel(booked.bookingId), 409, 'not_cancellable');
  });

  test('a body with fields is invalid_request; another visitor gets booking_not_found', async ({ api, booked, ip }) => {
    await expectError(await api.cancel(booked.bookingId, { reason: 'x' }), 400, 'invalid_request');
    const other = await stranger(ip);
    await expectError(await other.post(`api/booking/${booked.bookingId}/cancel`, { data: {} }), 404, 'booking_not_found');
    await other.dispose();
    const { booking } = await json(await api.booking(booked.bookingId), S.bookingPageBody);
    expect(booking.status).toBe('confirmed');
  });
});

test.describe('GET /api/bookings', { tag: ['@api', '@booking'] }, () => {
  test('signed out: none', async ({ api }) => {
    expect(await json(await api.bookings(), S.bookingsBody)).toEqual({ bookings: [] });
  });

  test('signed in: the account\'s bookings that went through, cancelled ones marked', async ({ api, booked }) => {
    let { bookings } = await json(await api.bookings(), S.bookingsBody);
    expect(bookings).toEqual([{ id: booked.bookingId, status: 'confirmed', hotelName: booked.booking.hotelName, checkIn: booked.booking.checkIn, checkOut: booked.booking.checkOut }]);
    await json(await api.cancel(booked.bookingId), S.bookingBody);
    ({ bookings } = await json(await api.bookings(), S.bookingsBody));
    expect(bookings[0].status).toBe('cancelled');
  });

  test('a booking still to pay is not listed', async ({ api, prebooked, signedIn: _ }) => {
    void prebooked;
    expect((await json(await api.bookings(), S.bookingsBody)).bookings).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Headers() }));

import { rawQuery, resetDb, seedUser } from './harness';
import { seedOffer, seedProperty, seedSearch } from './fixtures';
import { DOWN, RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { roomsLabel } from '@/lib/finder/rooms';
import { searchMarginPct } from '@/lib/pricing';
import { sendCode, MAX_ATTEMPTS } from '@/server/auth/otp';
import { bookPaid, bookingView, cancelBooking, confirmCheckout, PRICE_CHECK_TTL_MS, startCheckout, type ConfirmInput } from '@/server/checkout';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { getBooking, transitionBooking } from '@/server/repos/bookings';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, updateStay } from '@/server/repos/sessions';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizeBooking, normalizeCancel, normalizePrebook, normalizeRates } from '@/server/supplier/liteapi/normalize';
import { bookingResponse, cancelResponse, prebookResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import type { BookRequest, SupplierAdapter, SupplierError } from '@/server/supplier/types';
import { buildSessionView, offerFees } from '@/server/view';
import { getOffer } from '@/server/repos/offers';

beforeEach(resetDb);
const KEY = process.env.LITE_API_KEY;
beforeEach(() => {
  process.env.LITE_API_KEY = 'sand_test';
});
afterEach(() => {
  process.env.LITE_API_KEY = KEY;
});

const TODAY = '2026-11-11';
const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'priorities', priorities: ['cheapest'] },
];
let prebooks = 0;
const REFUSED: SupplierError = { kind: 'supplier', status: 400, code: 2001, message: 'rate no longer available', retryable: false };

/** A search with a shortlist, an anonymous owner, and the first card's offer. */
async function searched() {
  const recorded = recordedSupplier();
  const session = await createSession({ anonId: 'anon-checkout' });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: recorded.supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  const current = (await getSession(session.id))!;
  const card = (await buildSessionView(current)).shortlist[0];
  return { session: current, offer: card.offer!, hotel: card.property.name };
}

/** The booking half of the supplier, from recorded sandbox answers. `price` is what the re-check says now. */
function bookingSupplier(opts: { price: number; book?: 'ok' | 'timeout' | 'refused' }) {
  const books: BookRequest[] = [];
  const cancels: string[] = [];
  const base = recordedSupplier().supplier;
  const supplier: SupplierAdapter = {
    ...base,
    async recheckRate() {
      const check = normalizePrebook(prebookResponse.parse(fixture('prebook-payment-sdk')), RECORDED_AT);
      // Each re-check is a new prebook at the supplier (the row is unique per prebook id).
      prebooks += 1;
      // The recording is another hotel's prebook at the net rate: its suggested price is not this room's.
      return { ok: true, value: { ...check, suggestedSelling: null, prebookId: `${check.prebookId}-${prebooks}`, total: { amountMinor: opts.price, currency: 'EUR' } } };
    },
    async book(request) {
      books.push(request);
      // The supplier's slowness, so two presses really overlap.
      await new Promise((r) => setTimeout(r, 20));
      if (opts.book === 'timeout') return { ok: false, error: DOWN };
      if (opts.book === 'refused') return { ok: false, error: REFUSED };
      return { ok: true, value: normalizeBooking(bookingResponse.parse(fixture('book-confirmed'))) };
    },
    async cancel(id) {
      cancels.push(id);
      return { ok: true, value: normalizeCancel(cancelResponse.parse(fixture('booking-cancel'))) };
    },
  };
  return { supplier, books, cancels };
}

const EMAIL = 'guest@fixture.hotelfinder.invalid';
async function codeFor(email = EMAIL, now = RECORDED_AT) {
  const sent = await sendCode(email, now);
  if (!sent.ok || sent.delivery.via !== 'dev_mailbox') throw new Error('expected the dev mailbox');
  return sent.delivery.code;
}

async function started(price?: number, book?: 'ok' | 'timeout' | 'refused') {
  const s = await searched();
  const sup = bookingSupplier({ price: price ?? s.offer.totalMinor, book });
  const result = await startCheckout({ session: s.session, offerId: s.offer.id, supplier: sup.supplier });
  if (!result.ok) throw new Error(result.error);
  return { ...s, ...sup, booking: result.booking };
}

const confirmWith = (base: { booking: { id: string; totalMinor: number }; supplier: SupplierAdapter }, over: Partial<ConfirmInput> = {}) =>
  confirmCheckout({
    bookingId: base.booking.id,
    signedInUserId: null,
    email: EMAIL,
    code: '',
    firstName: 'Ana',
    lastName: 'Silva',
    wallet: 'apple_pay',
    acceptedTotalMinor: base.booking.totalMinor,
    supplier: base.supplier,
    now: new Date(RECORDED_AT.getTime() + 60_000),
    ...over,
  });

describe('checkout', () => {
  it('Book: the rate is re-checked and the booking is written, with what was booked, before any payment', async () => {
    const t = await started();
    expect(t.booking).toMatchObject({
      status: 'prebooked',
      userId: null,
      hotelName: t.hotel,
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      adults: 2,
      rooms: 1,
      totalMinor: t.offer.totalMinor,
      quotedTotalMinor: t.offer.totalMinor,
    });
    expect(bookingView(t.booking, RECORDED_AT)).toMatchObject({ priceChanged: false, priceCheckStale: false, reference: null });
    expect(t.books).toHaveLength(0);
  });

  it('a rate the supplier no longer has is said so, and nothing is written', async () => {
    const s = await searched();
    const sup = bookingSupplier({ price: 1 });
    sup.supplier.recheckRate = async () => ({ ok: false, error: REFUSED });
    expect(await startCheckout({ session: s.session, offerId: s.offer.id, supplier: sup.supplier })).toEqual({ ok: false, error: 'rate_gone' });
  });

  it('one press, signed out: the code signs in, the test payment is taken, the hotel books once, the chat says so', async () => {
    const t = await started();
    const code = await codeFor();
    const r = await confirmWith(t, { code });
    expect(r).toMatchObject({ ok: true, signedInAs: expect.any(String) });
    const row = (await getBooking(t.booking.id))!;
    expect(row).toMatchObject({
      status: 'confirmed',
      userId: r.signedInAs,
      paidWith: 'apple_pay',
      testPayment: true,
      holderFirstName: 'Ana',
      holderLastName: 'Silva',
      holderEmail: EMAIL,
      supplierBookingId: 'yzAvfyYq5',
    });
    expect(t.books).toHaveLength(1);
    expect(t.books[0]).toMatchObject({ prebookId: t.booking.prebookId, payment: 'sandbox_test', guests: [{ firstName: 'Ana', lastName: 'Silva', email: EMAIL }] });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Booked: ${t.hotel}, 11–13 Dec, 2 nights. Reference yzAvfyYq5.`);
  });

  it('a wrong code stops before any payment; the code is single-use; five wrong tries end it', async () => {
    const t = await started();
    const code = await codeFor();
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await confirmWith(t, { code: wrong })).toMatchObject({ ok: false, error: 'code_wrong', signedInAs: null });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'prebooked', userId: null, paidWith: null });
    expect(t.books).toHaveLength(0);
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) await confirmWith(t, { code: wrong });
    expect(await confirmWith(t, { code: wrong })).toMatchObject({ ok: false, error: 'code_expired' });
    expect(await confirmWith(t, { code })).toMatchObject({ ok: false, error: 'code_expired' });

    const fresh = await codeFor(EMAIL, new Date(RECORDED_AT.getTime() + 1000));
    expect(await confirmWith(t, { code: fresh })).toMatchObject({ ok: true });
    const again = await started();
    expect(await confirmWith(again, { code: fresh })).toMatchObject({ ok: false, error: 'code_expired' });
  });

  it('a changed price is shown with both numbers and only the new one, pressed again, can be paid', async () => {
    const s = await searched();
    const sup = bookingSupplier({ price: s.offer.totalMinor + 1234 });
    const r = await startCheckout({ session: s.session, offerId: s.offer.id, supplier: sup.supplier });
    if (!r.ok) throw new Error(r.error);
    expect(bookingView(r.booking, RECORDED_AT)).toMatchObject({ priceChanged: true, quotedTotalMinor: s.offer.totalMinor, totalMinor: s.offer.totalMinor + 1234 });
    const t = { ...sup, booking: r.booking };
    const code = await codeFor();
    expect(await confirmWith(t, { code, acceptedTotalMinor: s.offer.totalMinor })).toMatchObject({ ok: false, error: 'price_changed' });
    expect(sup.books).toHaveLength(0);
    expect(await confirmWith(t, { code })).toMatchObject({ ok: true });
  });

  it('a price check older than 20 minutes is checked again before paying', async () => {
    const t = await started();
    const code = await codeFor();
    const late = new Date(t.booking.createdAt.getTime() + PRICE_CHECK_TTL_MS + 1000);
    expect(await confirmWith(t, { code, now: late })).toMatchObject({ ok: false, error: 'price_stale' });
    expect(t.books).toHaveLength(0);
  });

  it('two presses at once: one booking at the supplier, never two', async () => {
    const t = await started();
    const user = (await confirmWith(t, { code: await codeFor() })).signedInAs!;
    const second = await started();
    const [a, b] = await Promise.all([confirmWith(second, { signedInUserId: user }), confirmWith(second, { signedInUserId: user })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: 'booking_not_payable' });
    expect(second.books).toHaveLength(1);
  });

  it('the claim: a paid booking sent to the supplier twice at once is booked once', async () => {
    const t = await started();
    await transitionBooking(t.booking.id, 'payment_pending');
    const paid = (await transitionBooking(t.booking.id, 'paid'))!;
    const guest = { firstName: 'Ana', lastName: 'Silva', email: EMAIL };
    const [a, b] = await Promise.all([bookPaid({ booking: paid, guest, test: true, supplier: t.supplier }), bookPaid({ booking: paid, guest, test: true, supplier: t.supplier })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(t.books).toHaveLength(1);
  });

  it('the hotel not answering leaves the outcome unknown: never failed, never booked again', async () => {
    const t = await started(undefined, 'timeout');
    expect(await confirmWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'booking_unknown' });
    expect((await getBooking(t.booking.id))!.status).toBe('booking');
    expect(await confirmWith(t, { code: await codeFor(EMAIL, new Date(RECORDED_AT.getTime() + 1000)) })).toMatchObject({ ok: false, error: 'booking_not_payable' });
    expect(t.books).toHaveLength(1);
  });

  it('the hotel refusing ends the booking as failed', async () => {
    const t = await started(undefined, 'refused');
    expect(await confirmWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'booking_failed' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'failed', failureCode: 'booking_failed' });
  });

  it('with a live supplier key there is no test payment: nothing is paid or booked', async () => {
    process.env.LITE_API_KEY = 'prod_key';
    const t = await started();
    expect(await confirmWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'payment_unavailable' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'prebooked', paidWith: null });
    expect(t.books).toHaveLength(0);
  });

  it('a guest name is required as on the ID', async () => {
    const t = await started();
    expect(await confirmWith(t, { code: await codeFor(), firstName: ' ' })).toMatchObject({ ok: false, error: 'name_missing' });
    expect(await confirmWith(t, { firstName: '<script>' })).toMatchObject({ ok: false, error: 'name_missing' });
  });

  it('a special request is cleaned, kept on the booking, sent with book once, and shown back', async () => {
    const t = await started();
    const r = await confirmWith(t, { code: await codeFor(), specialRequest: '  Late arrival, about 23:00.\r\n\r\n\r\nA cot, please.\u0000 ' });
    expect(r).toMatchObject({ ok: true });
    const cleaned = 'Late arrival, about 23:00.\n\nA cot, please.';
    expect(t.books).toHaveLength(1);
    expect(t.books[0].specialRequest).toBe(cleaned);
    const row = (await getBooking(t.booking.id))!;
    expect(row.specialRequest).toBe(cleaned);
    expect(bookingView(row, RECORDED_AT).specialRequest).toBe(cleaned);
  });

  it('no special request is null all the way to the supplier', async () => {
    const t = await started();
    expect(await confirmWith(t, { code: await codeFor(), specialRequest: '  \n ' })).toMatchObject({ ok: true });
    expect(t.books[0].specialRequest).toBeNull();
    expect((await getBooking(t.booking.id))!.specialRequest).toBeNull();
  });

  it('a special request over the limit stops before the code, the payment and the hotel', async () => {
    const t = await started();
    const code = await codeFor();
    expect(await confirmWith(t, { code, specialRequest: 'a'.repeat(501) })).toMatchObject({ ok: false, error: 'request_too_long', signedInAs: null });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'prebooked', paidWith: null, specialRequest: null });
    expect(t.books).toHaveLength(0);
    // The code was not spent: the same one still works.
    expect(await confirmWith(t, { code, specialRequest: 'a'.repeat(500) })).toMatchObject({ ok: true });
  });

  it('what is paid at the hotel is kept with the booking, each charge named and in its own currency', async () => {
    const t = await started();
    const view = bookingView(t.booking, RECORDED_AT);
    // The charges of the room the re-check held: signed out, the card's room fetched at the hotel's public price.
    const held = (await getOffer(t.booking.offerId!, t.session.id, 'public'))!;
    expect(held.lowerForMembers).toBe(false);
    const atHotel = offerFees(held.taxesAndFees).filter((f) => !f.included);
    expect(atHotel.length).toBeGreaterThan(0);
    expect(view.payAtPropertyFees).toEqual(atHotel.map(({ description, amountMinor, currency }) => ({ description, amountMinor, currency })));
    // The sum already on the row is the same charges, in the offer's currency.
    expect(view.payAtPropertyMinor).toBe(atHotel.filter((f) => f.currency === t.offer.currency).reduce((n, f) => n + f.amountMinor, 0));
    // A booking from before the charges were kept says so with null, not with "nothing".
    expect(bookingView({ ...t.booking, payAtPropertyFees: null }, RECORDED_AT).payAtPropertyFees).toBeNull();
  });

  describe('two rooms: checkout books exactly the rooms on the card', () => {
    // Recorded 2026-11-13: a search for 2 + 1 adults, its two-room offer with two
    // different rooms, that offer's prebook, and the one booking it made.
    const prebooked = () => normalizePrebook(prebookResponse.parse(fixture('prebook-mixed-rooms')), RECORDED_AT);
    async function twoRoomCard(over: { roomName?: string | null } = {}) {
      // Signed in: this is about the rooms. The recorded group prebook is 3 cents under
      // the hotel's public price, which a signed-out visitor is never held at.
      const { session, stay } = await seedSearch({ userId: (await seedUser('rooms@pg.test')).id });
      await updateStay(stay.id, session.id, { adults: 3, childrenAges: [], rooms: null });
      const searched = normalizeRates(ratesResponse.parse(fixture('rates-mixed-rooms')), 15, RECORDED_AT).offers.find((o) => o.supplierOfferId === prebooked().supplierOfferId)!;
      const property = await seedProperty(searched.supplierHotelId, 'Vincci Porto');
      const offer = await seedOffer(
        { sessionId: session.id, stayId: stay.id, propertyId: property.id },
        { supplierOfferId: searched.supplierOfferId, audience: 'member', marginPct: searchMarginPct().toFixed(2), totalMinor: searched.total.amountMinor, suggestedSellingMinor: null, payAtPropertyMinor: searched.payAtProperty.amountMinor, rooms: searched.rooms, roomName: roomsLabel(searched.rooms), fetchedAt: RECORDED_AT, expiresAt: new Date(RECORDED_AT.getTime() + 15 * 60_000), ...over },
      );
      return { session: (await getSession(session.id))!, offer };
    }
    function roomsSupplier(prebook: string) {
      const books: BookRequest[] = [];
      const supplier: SupplierAdapter = {
        ...recordedSupplier().supplier,
        recheckRate: async () => ({ ok: true, value: normalizePrebook(prebookResponse.parse(fixture(prebook)), RECORDED_AT) }),
        async book(request) {
          books.push(request);
          return { ok: true, value: normalizeBooking(bookingResponse.parse(fixture('book-mixed-rooms'))) };
        },
      };
      return { supplier, books };
    }

    it('the re-check holds the same two rooms: the booking is for two rooms, named as the supplier holds them, and book gets one guest per room', async () => {
      const card = await twoRoomCard();
      expect(card.offer.roomName).toBe('2 rooms: Vincci Room (2 adults) + Vincci Room Uso Individual (1 adult)');
      const sup = roomsSupplier('prebook-mixed-rooms');
      const started = await startCheckout({ session: card.session, offerId: card.offer.id, supplier: sup.supplier });
      if (!started.ok) throw new Error(started.error);
      expect(started.booking).toMatchObject({ rooms: 2, adults: 3, roomName: '2 rooms: Vincci Room (2 adults) + Vincci Room Uso Individual (1 adult)', totalMinor: 36346, quotedTotalMinor: 36346 });

      const done = await confirmWith({ booking: started.booking, supplier: sup.supplier }, { code: await codeFor() });
      expect(done).toMatchObject({ ok: true, booking: { status: 'confirmed', supplierBookingId: 'hMt2HdnXq' } });
      expect(sup.books).toHaveLength(1);
      expect(sup.books[0]).toMatchObject({ prebookId: prebooked().prebookId, payment: 'sandbox_test' });
      expect(sup.books[0].guests).toHaveLength(2);
    });

    it('the rooms are named as the re-check holds them, not as the card had them', async () => {
      const card = await twoRoomCard({ roomName: null });
      const started = await startCheckout({ session: card.session, offerId: card.offer.id, supplier: roomsSupplier('prebook-mixed-rooms').supplier });
      expect(started).toMatchObject({ ok: true, booking: { roomName: '2 rooms: Vincci Room (2 adults) + Vincci Room Uso Individual (1 adult)' } });
    });

    it('a re-check holding other rooms (one room for two) is not the offer chosen: nothing is written, nothing is paid', async () => {
      const card = await twoRoomCard();
      const sup = roomsSupplier('prebook-payment-sdk');
      expect(await startCheckout({ session: card.session, offerId: card.offer.id, supplier: sup.supplier })).toEqual({ ok: false, error: 'rate_gone' });
      expect(await rawQuery('select 1 from bookings')).toHaveLength(0);
      expect(sup.books).toHaveLength(0);
    });
  });

  it('cancel: through the supplier, with the refund it reports', async () => {
    const t = await started();
    await confirmWith(t, { code: await codeFor() });
    const r = await cancelBooking({ bookingId: t.booking.id, supplier: t.supplier });
    expect(r).toMatchObject({ ok: true, booking: { status: 'cancelled', refundMinor: 15804, cancelFeeMinor: 0 } });
    expect(t.cancels).toEqual(['yzAvfyYq5']);
    expect(await cancelBooking({ bookingId: t.booking.id, supplier: t.supplier })).toEqual({ ok: false, error: 'not_cancellable' });
  });
});

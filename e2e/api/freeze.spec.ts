import { expect, stranger, test } from '../fixtures/test';
import { expectError, json, type Api } from '../support/api';
import { E2E_CRON_SECRET, uniqueEmail } from '../support/env';
import * as S from '../support/schemas';

/**
 * Deal Freeze (docs/deal-freeze.md): a free-cancellation rate booked with the
 * supplier for real and nothing paid; kept (paid) or released (cancelled with
 * the hotel) before the hold ends; a scheduled sweep releases ended holds.
 * Every sandbox booking made here ends cancelled or released.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function freezeAsNewGuest(api: Api, b: { bookingId: string; booking: S.BookingViewBody }) {
  const email = uniqueEmail('freeze');
  const code = await api.sendCode(email);
  const res = await api.freeze(b.bookingId, { email, code, firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: b.booking.totalMinor });
  return { email, res };
}

/** Leave nothing held in the sandbox. */
async function cleanUp(api: Api, bookingId: string) {
  const res = await api.booking(bookingId);
  if (!res.ok()) return;
  const status = (await res.json()).booking.status;
  if (status === 'frozen') await api.release(bookingId);
  if (status === 'confirmed') await api.cancel(bookingId);
}

test.describe('POST /api/booking/[id]/freeze', { tag: ['@api', '@booking', '@freeze'] }, () => {
  test('books the free-cancellation rate with nothing paid, held until the time offered, and signs in', async ({ api }) => {
    test.setTimeout(180_000);
    const b = await api.freezable();
    expect(b.booking.freezeOffer!.until > new Date(Date.now() + 23 * 3_600_000).toISOString()).toBe(true);
    try {
      const { email, res } = await freezeAsNewGuest(api, b);
      const { booking } = await json(res, S.bookingBody);
      expect(booking).toMatchObject({ status: 'frozen', frozenUntil: b.booking.freezeOffer!.until, paidWith: null, holder: { firstName: 'Ana', lastName: 'Silva', email: email.toLowerCase() }, freezeOffer: null, releasedBy: null });
      expect(booking.reference).toMatch(/\S{4,}/);
      // The reminder is due a day before the hold ends (or now, if that is sooner).
      expect(Date.parse(booking.freezeReminderDueAt!)).toBeLessThanOrEqual(Date.parse(booking.frozenUntil!));
      expect(booking.freezeReminderSentAt).toBeNull();
      // The hold ends 48 h before the hotel's own free-cancellation deadline.
      expect(Date.parse(booking.freeCancellationUntil!) - Date.parse(booking.frozenUntil!)).toBeGreaterThanOrEqual(48 * 3_600_000);
      expect((await json(await api.me(), S.meBody)).user).toEqual({ email: email.toLowerCase() });
      // The account lists it as frozen; a second freeze of the same row is booking_not_payable.
      expect((await json(await api.bookings(), S.bookingsBody)).bookings).toEqual([expect.objectContaining({ id: b.bookingId, status: 'frozen' })]);
      await expectError(await api.freeze(b.bookingId, { email, code: '', firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: b.booking.totalMinor }), 409, 'booking_not_payable');
      // No mail service here: the page is the reminder, and says so.
      expect((await json(await api.booking(b.bookingId), S.bookingPageBody)).mail).toBe(false);
    } finally {
      await cleanUp(api, b.bookingId);
    }
  });

  test('refusals before anything is booked, each with its code; the booking is still to pay after them', async ({ api, prebooked }) => {
    // The canonical stay's rates: refundable or not, a week out few can be frozen.
    const id = prebooked.bookingId;
    const total = prebooked.booking.totalMinor;
    const email = uniqueEmail('freeze-no');
    const code = await api.sendCode(email);
    const base = { email, code, firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: total };
    await expectError(await api.freeze(id, { ...base, acceptedTotalMinor: total + 1 }), 409, 'price_changed');
    if (!prebooked.booking.freezeOffer) await expectError(await api.freeze(id, base), 409, 'freeze_not_eligible');
    await expectError(await api.freeze(id, { ...base, wallet: 'apple_pay' }), 400, 'invalid_request');
    await expectError(await api.freeze(id, { ...base, acceptedTotalMinor: -5 }), 400, 'invalid_request');
    await expectError(await api.freeze(id, { email, firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: total }), 400, 'invalid_request');
    const { booking } = await json(await api.booking(id), S.bookingPageBody);
    expect(booking.status).toBe('prebooked');
  });

  test('a freezable rate: names, email and code are each checked, and nothing is booked until they pass', async ({ api }) => {
    test.setTimeout(180_000);
    const b = await api.freezable();
    const email = uniqueEmail('freeze-check');
    const code = await api.sendCode(email);
    const base = { email, code, firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: b.booking.totalMinor };
    await expectError(await api.freeze(b.bookingId, { ...base, firstName: '' }), 400, 'name_missing');
    await expectError(await api.freeze(b.bookingId, { ...base, email: 'nope' }), 400, 'email_invalid');
    await expectError(await api.freeze(b.bookingId, { ...base, code: code === '000000' ? '111111' : '000000' }), 400, 'code_wrong');
    expect((await json(await api.booking(b.bookingId), S.bookingPageBody)).booking.status).toBe('prebooked');
    expect((await json(await api.me(), S.meBody)).user).toBeNull();
  });

  test('another visitor cannot freeze it: 404 booking_not_found', async ({ prebooked, ip }) => {
    const other = await stranger(ip);
    await expectError(
      await other.post(`api/booking/${prebooked.bookingId}/freeze`, { data: { email: uniqueEmail('x'), code: '123456', firstName: 'A', lastName: 'B', acceptedTotalMinor: prebooked.booking.totalMinor } }),
      404,
      'booking_not_found',
    );
    await expectError(await other.post(`api/booking/${UNKNOWN}/freeze`, { data: { email: uniqueEmail('x'), code: '1', firstName: 'A', lastName: 'B', acceptedTotalMinor: 1 } }), 404, 'booking_not_found');
    await other.dispose();
  });

  test('three frozen at a time per account: the fourth is freeze_limit, and nothing is booked for it', async ({ api }) => {
    test.setTimeout(420_000);
    const made: string[] = [];
    try {
      const email = uniqueEmail('limit');
      const first = await api.freezable();
      const code = await api.sendCode(email);
      await json(await api.freeze(first.bookingId, { email, code, firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: first.booking.totalMinor }), S.bookingBody);
      made.push(first.bookingId);
      for (let i = 0; i < 2; i++) {
        const next = await api.freezable();
        await json(await api.freeze(next.bookingId, { email, code: '', firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: next.booking.totalMinor }), S.bookingBody);
        made.push(next.bookingId);
      }
      const fourth = await api.freezable();
      await expectError(await api.freeze(fourth.bookingId, { email, code: '', firstName: 'Ana', lastName: 'Silva', acceptedTotalMinor: fourth.booking.totalMinor }), 409, 'freeze_limit');
      expect((await json(await api.booking(fourth.bookingId), S.bookingPageBody)).booking.status).toBe('prebooked');
    } finally {
      for (const id of made) await cleanUp(api, id);
    }
  });
});

test.describe('POST /api/booking/[id]/keep', { tag: ['@api', '@booking', '@freeze'] }, () => {
  test('pays the held price: an ordinary confirmed booking, same reference; checked before paying', async ({ api, ip }) => {
    test.setTimeout(180_000);
    const b = await api.freezable();
    try {
      const { booking: frozen } = await json((await freezeAsNewGuest(api, b)).res, S.bookingBody);
      await expectError(await api.keep(b.bookingId, { wallet: 'apple_pay', acceptedTotalMinor: frozen.totalMinor + 1 }), 409, 'price_changed');
      await expectError(await api.keep(b.bookingId, { wallet: 'paypal', acceptedTotalMinor: frozen.totalMinor }), 400, 'invalid_request');
      await expectError(await api.keep(b.bookingId, { wallet: 'apple_pay' }), 400, 'invalid_request');
      const other = await stranger(ip);
      await expectError(await other.post(`api/booking/${b.bookingId}/keep`, { data: { wallet: 'apple_pay', acceptedTotalMinor: frozen.totalMinor } }), 404, 'booking_not_found');
      await other.dispose();
      const { booking } = await json(await api.keep(b.bookingId, { wallet: 'google_pay', acceptedTotalMinor: frozen.totalMinor }), S.bookingBody);
      expect(booking).toMatchObject({ status: 'confirmed', paidWith: 'google_pay', testPayment: true, reference: frozen.reference });
      // Kept once: a second press does not pay twice.
      await expectError(await api.keep(b.bookingId, { wallet: 'google_pay', acceptedTotalMinor: frozen.totalMinor }), 409, 'booking_not_payable');
    } finally {
      await cleanUp(api, b.bookingId);
    }
  });

  test('a booking that is not frozen cannot be kept', async ({ api, prebooked }) => {
    await api.signIn(uniqueEmail('keep-none'));
    // The prebooked row belongs to the anonymous search this browser started, adopted at sign-in.
    // It is this visitor's booking (GET answers it), just not frozen: "not payable", not "not on this account".
    await json(await api.booking(prebooked.bookingId), S.bookingPageBody);
    await expectError(await api.keep(prebooked.bookingId, { wallet: 'apple_pay', acceptedTotalMinor: prebooked.booking.totalMinor }), 409, 'booking_not_payable');
    expect((await json(await api.booking(prebooked.bookingId), S.bookingPageBody)).booking.status).toBe('prebooked');
  });
});

test.describe('POST /api/booking/[id]/release', { tag: ['@api', '@booking', '@freeze'] }, () => {
  test('cancels the frozen room with the hotel: released by the guest, nothing paid; once only', async ({ api, ip }) => {
    test.setTimeout(180_000);
    const b = await api.freezable();
    try {
      const { booking: frozen } = await json((await freezeAsNewGuest(api, b)).res, S.bookingBody);
      await expectError(await api.release(b.bookingId, { now: true }), 400, 'invalid_request');
      const other = await stranger(ip);
      await expectError(await other.post(`api/booking/${b.bookingId}/release`, { data: {} }), 404, 'booking_not_found');
      await other.dispose();
      const { booking } = await json(await api.release(b.bookingId), S.bookingBody);
      expect(booking).toMatchObject({ status: 'cancelled', releasedBy: 'guest', reference: frozen.reference, paidWith: null });
      await expectError(await api.release(b.bookingId), 409, 'not_cancellable');
      await expectError(await api.keep(b.bookingId, { wallet: 'apple_pay', acceptedTotalMinor: frozen.totalMinor }), 409, 'booking_not_payable');
    } finally {
      await cleanUp(api, b.bookingId);
    }
  });

  test('a booking still to pay is not_cancellable', async ({ api, prebooked }) => {
    await expectError(await api.release(prebooked.bookingId), 409, 'not_cancellable');
  });
});

test.describe('GET /api/freeze/sweep', { tag: ['@api', '@freeze'] }, () => {
  test('without the scheduler\'s secret it is not there: 404 not_allowed, and nothing runs', async ({ api }) => {
    await expectError(await api.sweep(), 404, 'not_allowed');
    await expectError(await api.sweep('Bearer wrong-secret-of-enough-length'), 404, 'not_allowed');
    await expectError(await api.sweep(E2E_CRON_SECRET), 404, 'not_allowed');
    await expectError(await api.sweep(`Basic ${E2E_CRON_SECRET}`), 404, 'not_allowed');
  });

  test('with it: one pass, and a report of what it released, read back and reminded', async ({ api }) => {
    const report = await json(await api.sweep(`Bearer ${E2E_CRON_SECRET}`), S.sweepBody);
    // No hold in this run has ended, and no mail service is set: nothing is sent.
    expect(report.remindersSent).toBe(0);
    expect(report.releaseFailed).toBe(0);
  });
});

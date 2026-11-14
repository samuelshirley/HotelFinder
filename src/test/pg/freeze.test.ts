import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Headers() }));
/** The real payment module, with every payment taken counted. */
const payments = vi.hoisted(() => ({ taken: 0 }));
vi.mock('@/server/payments', async (original) => {
  const real = await original<typeof import('@/server/payments')>();
  return { ...real, takePayment: (...args: Parameters<typeof real.takePayment>) => ((payments.taken += 1), real.takePayment(...args)) };
});

import { resetDb } from './harness';
import { DOWN, RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { sendCode } from '@/server/auth/otp';
import { bookingView, cancelBooking, startCheckout } from '@/server/checkout';
import { freezeBooking, keepFrozen, releaseFrozen, reminderEmail, settleFreeze, sweepAllowed, sweepFreezes, type FreezeInput } from '@/server/freeze';
import { MAX_ACTIVE_FREEZES, RELEASE_MARGIN_MS } from '@/lib/freeze';
import { formatMoney } from '@/lib/replies';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { getBooking } from '@/server/repos/bookings';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession } from '@/server/repos/sessions';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizeBooking, normalizeCancel, normalizePrebook } from '@/server/supplier/liteapi/normalize';
import { bookingResponse, cancelResponse, prebookResponse } from '@/server/supplier/liteapi/schemas';
import type { BookRequest, SupplierAdapter, SupplierError } from '@/server/supplier/types';
import { buildSessionView, offerFees } from '@/server/view';

/**
 * Deal Freeze on real Postgres, against recorded sandbox answers. The price
 * check is the recorded payment-SDK prebook; for a refundable rate it carries
 * the terms recorded on the refundable booking (`book-confirmed`: RFN, free
 * until 2026-11-25 09:59 GMT), because the refundable prebook was recorded
 * without the payment SDK and has no transaction id. Then that booking, its
 * cancel and its read-backs.
 */

beforeEach(resetDb);
beforeEach(() => {
  payments.taken = 0;
});
const KEY = process.env.LITE_API_KEY;
const RESEND = process.env.RESEND_API_KEY;
beforeEach(() => {
  process.env.LITE_API_KEY = 'sand_test';
  delete process.env.RESEND_API_KEY;
});
afterEach(() => {
  process.env.LITE_API_KEY = KEY;
  if (RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = RESEND;
  vi.unstubAllGlobals();
});

const TODAY = '2026-11-11';
const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'priorities', priorities: ['cheapest'] },
];
const DEADLINE = Date.parse('2026-11-25T09:59:00Z');
const FROZEN_UNTIL = new Date(DEADLINE - RELEASE_MARGIN_MS);
const SOON = new Date(RECORDED_AT.getTime() + 60_000);
const REFUSED: SupplierError = { kind: 'supplier', status: 400, code: 2001, message: 'refused', retryable: false };
let prebooks = 0;

type Behaviour = {
  prebook?: 'refundable' | 'nonrefundable';
  book?: 'ok' | 'timeout' | 'refused' | 'nonrefundable';
  cancel?: 'ok' | 'timeout' | 'refused';
  readBack?: 'booking-get' | 'booking-get-after-cancel';
};

/** The booking half of the supplier, from recorded sandbox answers, counting every call. */
function freezeSupplier(b: Behaviour = {}) {
  const books: BookRequest[] = [];
  const cancels: string[] = [];
  const reads: string[] = [];
  const supplier: SupplierAdapter = {
    ...recordedSupplier().supplier,
    async recheckRate() {
      const check = normalizePrebook(prebookResponse.parse(fixture('prebook-payment-sdk')), RECORDED_AT);
      const refundable = normalizeBooking(bookingResponse.parse(fixture('book-confirmed'))).cancellation;
      prebooks += 1;
      // The recording is another hotel's prebook at the net rate: its suggested price is not this room's.
      return { ok: true, value: { ...check, suggestedSelling: null, prebookId: `${check.prebookId}-${prebooks}`, cancellation: b.prebook === 'nonrefundable' ? check.cancellation : refundable } };
    },
    async book(request) {
      books.push(request);
      await new Promise((r) => setTimeout(r, 20));
      if (b.book === 'timeout') return { ok: false, error: DOWN };
      if (b.book === 'refused') return { ok: false, error: REFUSED };
      return { ok: true, value: normalizeBooking(bookingResponse.parse(fixture(b.book === 'nonrefundable' ? 'book-nonrefundable' : 'book-confirmed'))) };
    },
    async cancel(id) {
      cancels.push(id);
      await new Promise((r) => setTimeout(r, 20));
      if (b.cancel === 'timeout') return { ok: false, error: DOWN };
      if (b.cancel === 'refused') return { ok: false, error: REFUSED };
      return { ok: true, value: normalizeCancel(cancelResponse.parse(fixture('booking-cancel'))) };
    },
    async getBooking(id) {
      reads.push(id);
      return { ok: true, value: normalizeBooking(bookingResponse.parse(fixture(b.readBack ?? 'booking-get-after-cancel'))) };
    },
  };
  return { supplier, books, cancels, reads };
}

const EMAIL = 'guest@fixture.hotelfinder.invalid';
async function codeFor(email = EMAIL, now = RECORDED_AT) {
  const sent = await sendCode(email, now);
  if (!sent.ok || sent.delivery.via !== 'dev_mailbox') throw new Error('expected the dev mailbox');
  return sent.delivery.code;
}

/** A search, its first card, and a fresh price check of a refundable rate. */
async function checkedOut(b: Behaviour = {}, anonId = 'anon-freeze', locale?: 'en' | 'es') {
  const recorded = recordedSupplier();
  const session = await createSession({ anonId });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: recorded.supplier, now: RECORDED_AT, today: TODAY })).toMatchObject({ ok: true });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  const current = (await getSession(session.id))!;
  const card = (await buildSessionView(current)).shortlist[0];
  const sup = freezeSupplier(b);
  const started = await startCheckout({ session: current, offerId: card.offer!.id, supplier: sup.supplier, locale });
  if (!started.ok) throw new Error(started.error);
  return { ...sup, session: current, hotel: card.property.name, booking: started.booking };
}

const freezeWith = (t: { booking: { id: string; totalMinor: number }; supplier: SupplierAdapter }, over: Partial<FreezeInput> = {}) =>
  freezeBooking({
    bookingId: t.booking.id,
    signedInUserId: null,
    email: EMAIL,
    code: '',
    firstName: 'Ana',
    lastName: 'Silva',
    acceptedTotalMinor: t.booking.totalMinor,
    supplier: t.supplier,
    now: SOON,
    ...over,
  });

async function frozen(b: Behaviour = {}) {
  const t = await checkedOut(b);
  const r = await freezeWith(t, { code: await codeFor() });
  if (!r.ok) throw new Error(r.error);
  return { ...t, userId: r.signedInAs!, booking: r.booking };
}

describe('Deal Freeze: freeze', () => {
  it('the checkout offers a freeze on a refundable rate, until 48 h before its free-cancellation deadline', async () => {
    const t = await checkedOut();
    expect(bookingView(t.booking, SOON).freezeOffer).toEqual({ until: FROZEN_UNTIL.toISOString(), reminderAt: new Date(FROZEN_UNTIL.getTime() - 24 * 3_600_000).toISOString() });
  });

  it('freeze: signs in with the code, books the rate once with no payment, holds it, and the chat says until when', async () => {
    const t = await checkedOut();
    const r = await freezeWith(t, { code: await codeFor() });
    expect(r).toMatchObject({ ok: true, signedInAs: expect.any(String) });
    const row = (await getBooking(t.booking.id))!;
    expect(row).toMatchObject({
      status: 'frozen',
      userId: r.signedInAs,
      supplierBookingId: 'yzAvfyYq5',
      holderFirstName: 'Ana',
      holderEmail: EMAIL,
      paidWith: null,
      testPayment: false,
      frozenUntil: FROZEN_UNTIL,
      freezeReminderDueAt: new Date(FROZEN_UNTIL.getTime() - 24 * 3_600_000),
      freezeReminderSentAt: null,
    });
    expect(t.books).toHaveLength(1);
    expect(payments.taken).toBe(0);
    expect(t.books[0]).toMatchObject({ prebookId: t.booking.prebookId, payment: 'sandbox_test', holder: { firstName: 'Ana', lastName: 'Silva', email: EMAIL } });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(
      `Frozen: ${t.hotel}, 11–13 Dec, 2 nights, held until 23 Nov, 09:59 UTC. Reference yzAvfyYq5. Confirm and pay before then, or it is released.`,
    );
    expect(bookingView(row, SOON)).toMatchObject({ status: 'frozen', freezeOffer: null, frozenUntil: FROZEN_UNTIL.toISOString(), releasedBy: null });
  });

  it('a non-refundable rate cannot be frozen: nothing is booked', async () => {
    const t = await checkedOut({ prebook: 'nonrefundable' });
    expect(bookingView(t.booking, SOON).freezeOffer).toBeNull();
    expect(await freezeWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'freeze_not_eligible' });
    expect(t.books).toHaveLength(0);
    expect((await getBooking(t.booking.id))!.status).toBe('prebooked');
  });

  it('too close to the deadline (less than a 24 h hold left) cannot be frozen', async () => {
    const t = await checkedOut();
    const late = new Date(FROZEN_UNTIL.getTime() - 23 * 3_600_000);
    expect(bookingView(t.booking, late).freezeOffer).toBeNull();
    expect(bookingView(t.booking, new Date(FROZEN_UNTIL.getTime() - 25 * 3_600_000)).freezeOffer).not.toBeNull();
    expect(await freezeWith(t, { code: await codeFor(), now: late })).toMatchObject({ ok: false, error: 'freeze_not_eligible' });
    expect(t.books).toHaveLength(0);
  });

  it('a wrong code, a changed price, a stale check or a missing name stop before any booking', async () => {
    const t = await checkedOut();
    const code = await codeFor();
    expect(await freezeWith(t, { code: code === '000000' ? '111111' : '000000' })).toMatchObject({ ok: false, error: 'code_wrong' });
    expect(await freezeWith(t, { code, acceptedTotalMinor: t.booking.totalMinor + 1 })).toMatchObject({ ok: false, error: 'price_changed' });
    expect(await freezeWith(t, { code, now: new Date(t.booking.createdAt.getTime() + 21 * 60_000) })).toMatchObject({ ok: false, error: 'price_stale' });
    expect(await freezeWith(t, { code, lastName: ' ' })).toMatchObject({ ok: false, error: 'name_missing' });
    expect(t.books).toHaveLength(0);
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'prebooked', userId: null });
  });

  it('with a live supplier key there is no freeze: it would book on the business account', async () => {
    process.env.LITE_API_KEY = 'prod_key';
    const t = await checkedOut();
    expect(await freezeWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'freeze_unavailable' });
    expect(t.books).toHaveLength(0);
  });

  it('THE CLAIM: two presses at once book once', async () => {
    const t = await frozen();
    const second = await checkedOut();
    const [a, b] = await Promise.all([freezeWith(second, { signedInUserId: t.userId }), freezeWith(second, { signedInUserId: t.userId })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: 'booking_not_payable' });
    expect(second.books).toHaveLength(1);
  });

  it('the hotel not answering leaves it unknown: never failed, never booked again', async () => {
    const t = await checkedOut({ book: 'timeout' });
    expect(await freezeWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'booking_unknown' });
    expect((await getBooking(t.booking.id))!.status).toBe('freezing');
    expect(await freezeWith(t, { code: await codeFor(EMAIL, new Date(RECORDED_AT.getTime() + 1000)) })).toMatchObject({ ok: false, error: 'booking_not_payable' });
    expect(t.books).toHaveLength(1);
  });

  it('the hotel refusing ends it as failed', async () => {
    const t = await checkedOut({ book: 'refused' });
    expect(await freezeWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'booking_failed' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'failed', failureCode: 'booking_failed' });
  });

  it('booked on non-refundable terms after all: released at once, nothing held, the guest told', async () => {
    const t = await checkedOut({ book: 'nonrefundable' });
    expect(await freezeWith(t, { code: await codeFor() })).toMatchObject({ ok: false, error: 'freeze_terms_changed' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'cancelled', releasedBy: 'terms', supplierBookingId: '2U0GzrbQp' });
    expect(t.cancels).toEqual(['2U0GzrbQp']);
  });

  it(`at most ${MAX_ACTIVE_FREEZES} frozen at once per account`, async () => {
    const first = await frozen();
    for (let i = 1; i < MAX_ACTIVE_FREEZES; i++) {
      const t = await checkedOut();
      expect(await freezeWith(t, { signedInUserId: first.userId })).toMatchObject({ ok: true });
    }
    const over = await checkedOut();
    expect(await freezeWith(over, { signedInUserId: first.userId })).toMatchObject({ ok: false, error: 'freeze_limit' });
    expect(over.books).toHaveLength(0);
  });
});

describe('Deal Freeze: confirm (keep)', () => {
  it('pays the held price with the test wallet; no second book call; the chat says booked', async () => {
    const t = await frozen();
    const r = await keepFrozen({ bookingId: t.booking.id, userId: t.userId, wallet: 'google_pay', acceptedTotalMinor: t.booking.totalMinor, now: SOON });
    expect(r).toMatchObject({ ok: true, booking: { status: 'confirmed', paidWith: 'google_pay', testPayment: true, supplierBookingId: 'yzAvfyYq5' } });
    expect(payments.taken).toBe(1);
    expect(t.books).toHaveLength(1);
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Booked: ${t.hotel}, 11–13 Dec, 2 nights. Reference yzAvfyYq5.`);
    // Kept, it is an ordinary booking: cancelled through the supplier like any other.
    expect(await cancelBooking({ bookingId: t.booking.id, supplier: t.supplier })).toMatchObject({ ok: true, booking: { status: 'cancelled', refundMinor: 15804 } });
  });

  it('two presses pay once', async () => {
    const t = await frozen();
    const press = () => keepFrozen({ bookingId: t.booking.id, userId: t.userId, wallet: 'apple_pay', acceptedTotalMinor: t.booking.totalMinor, now: SOON });
    const [a, b] = await Promise.all([press(), press()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(payments.taken).toBe(1);
  });

  it('not after the hold ended, not another account, not a different price, not with a live key', async () => {
    const t = await frozen();
    const base = { bookingId: t.booking.id, userId: t.userId, wallet: 'apple_pay' as const, acceptedTotalMinor: t.booking.totalMinor, now: SOON };
    expect(await keepFrozen({ ...base, now: FROZEN_UNTIL })).toEqual({ ok: false, error: 'freeze_expired' });
    expect(await keepFrozen({ ...base, userId: '00000000-0000-0000-0000-000000000000' })).toEqual({ ok: false, error: 'booking_not_found' });
    expect(await keepFrozen({ ...base, acceptedTotalMinor: 1 })).toEqual({ ok: false, error: 'price_changed' });
    process.env.LITE_API_KEY = 'prod_key';
    expect(await keepFrozen(base)).toEqual({ ok: false, error: 'payment_unavailable' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'frozen', paidWith: null });
  });
});

describe('Deal Freeze: release', () => {
  it('cancels at the supplier once, with what it refunded; nothing was paid; the chat says released', async () => {
    const t = await frozen();
    const r = await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON });
    expect(r).toMatchObject({ ok: true, booking: { status: 'cancelled', releasedBy: 'guest', cancelFeeMinor: 0, testPayment: false } });
    expect(t.cancels).toEqual(['yzAvfyYq5']);
    expect(await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON })).toEqual({ ok: false, error: 'not_cancellable' });
    expect(t.cancels).toHaveLength(1);
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Released: ${t.hotel}. Reference yzAvfyYq5. Nothing was paid.`);
  });

  it('two releases at once cancel once', async () => {
    const t = await frozen();
    const rel = () => releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON });
    const [a, b] = await Promise.all([rel(), rel()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(t.cancels).toHaveLength(1);
  });

  it('a refused cancel leaves it frozen and releasable; a kept booking cannot be released', async () => {
    const t = await frozen({ cancel: 'refused' });
    expect(await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON })).toEqual({ ok: false, error: 'cancel_failed' });
    expect((await getBooking(t.booking.id))!).toMatchObject({ status: 'frozen', releasedBy: null });
    await keepFrozen({ bookingId: t.booking.id, userId: t.userId, wallet: 'apple_pay', acceptedTotalMinor: t.booking.totalMinor, now: SOON });
    expect(await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON })).toEqual({ ok: false, error: 'not_cancellable' });
  });

  it('a cancel with no answer is read back, never sent blind again', async () => {
    const t = await frozen({ cancel: 'timeout', readBack: 'booking-get-after-cancel' });
    expect(await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON })).toEqual({ ok: false, error: 'release_unknown' });
    expect((await getBooking(t.booking.id))!.status).toBe('releasing');
    const settled = await settleFreeze((await getBooking(t.booking.id))!, t.supplier, SOON);
    expect(settled).toMatchObject({ status: 'cancelled', releasedBy: 'guest' });
    expect(t.cancels).toHaveLength(1);
    expect(t.reads).toEqual(['yzAvfyYq5']);
  });

  it('read back still booked: frozen again, so it can be released again', async () => {
    const t = await frozen({ cancel: 'timeout', readBack: 'booking-get' });
    await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON });
    expect(await settleFreeze((await getBooking(t.booking.id))!, t.supplier, SOON)).toMatchObject({ status: 'frozen', releasedBy: null });
  });
});

describe('Deal Freeze: the hold ending, and the reminder', () => {
  it('opening a booking after its hold ended releases it', async () => {
    const t = await frozen();
    expect(await settleFreeze((await getBooking(t.booking.id))!, t.supplier, new Date(FROZEN_UNTIL.getTime() - 1))).toMatchObject({ status: 'frozen' });
    expect(t.cancels).toHaveLength(0);
    expect(await settleFreeze((await getBooking(t.booking.id))!, t.supplier, FROZEN_UNTIL)).toMatchObject({ status: 'cancelled', releasedBy: 'expiry' });
    expect(t.cancels).toEqual(['yzAvfyYq5']);
  });

  it('the sweep releases every ended hold once, even run twice at once, and leaves the rest', async () => {
    const ended = await frozen();
    const sup = ended.supplier;
    const report = await Promise.all([sweepFreezes({ now: FROZEN_UNTIL, supplierFor: () => sup }), sweepFreezes({ now: FROZEN_UNTIL, supplierFor: () => sup })]);
    expect(report.map((r) => r.released).sort()).toEqual([0, 1]);
    expect(ended.cancels).toHaveLength(1);
    expect((await getBooking(ended.booking.id))!).toMatchObject({ status: 'cancelled', releasedBy: 'expiry' });
  });

  it('with no mail service the reminder is display-only: nothing sent, nothing marked', async () => {
    const t = await frozen();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const report = await sweepFreezes({ now: t.booking.freezeReminderDueAt!, supplierFor: () => t.supplier });
    expect(report).toMatchObject({ remindersSent: 0, remindersDisplayOnly: 1, released: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await getBooking(t.booking.id))!.freezeReminderSentAt).toBeNull();
  });

  it('with Resend set, the due reminder is emailed once, to the holder, from the row; a failed send stays due', async () => {
    const t = await frozen();
    process.env.RESEND_API_KEY = 're_test';
    const sent: Array<{ to: string[]; subject: string; text: string }> = [];
    let answer = 500;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: answer });
      }),
    );
    const due = t.booking.freezeReminderDueAt!;
    expect(await sweepFreezes({ now: new Date(due.getTime() - 1), supplierFor: () => t.supplier })).toMatchObject({ remindersSent: 0 });
    expect(sent).toHaveLength(0);
    expect(await sweepFreezes({ now: due, supplierFor: () => t.supplier })).toMatchObject({ remindersSent: 0 });
    expect((await getBooking(t.booking.id))!.freezeReminderSentAt).toBeNull();
    answer = 200;
    expect(await sweepFreezes({ now: due, supplierFor: () => t.supplier })).toMatchObject({ remindersSent: 1 });
    expect(await sweepFreezes({ now: due, supplierFor: () => t.supplier })).toMatchObject({ remindersSent: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toEqual([EMAIL]);
    const row = (await getBooking(t.booking.id))!;
    expect(row.freezeReminderSentAt).toEqual(due);
    expect(sent[1]).toMatchObject(reminderEmail(row));
    expect(sent[1].subject).toBe(`Your frozen room at ${t.hotel} is released 23 Nov, 09:59 UTC`);
    expect(sent[1].text).toContain(`at ${formatMoney(row.totalMinor, row.currency)}.`);
    expect(sent[1].text).toContain('Reference yzAvfyYq5.');
  });

  it('two sweeps at once email the reminder once', async () => {
    const t = await frozen();
    process.env.RESEND_API_KEY = 're_test';
    const fetchSpy = vi.fn(async (_url: string) => {
      await new Promise((r) => setTimeout(r, 20));
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const now = t.booking.freezeReminderDueAt!;
    const reports = await Promise.all([sweepFreezes({ now, supplierFor: () => t.supplier }), sweepFreezes({ now, supplierFor: () => t.supplier })]);
    expect(reports.map((r) => r.remindersSent).sort()).toEqual([0, 1]);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('resend'))).toHaveLength(1);
  });

  it('the sweep endpoint is closed without a long CRON_SECRET, and open only to its exact bearer', () => {
    expect(sweepAllowed('Bearer ', '')).toBe(false);
    expect(sweepAllowed(null, 'a-long-enough-secret')).toBe(false);
    expect(sweepAllowed('Bearer short', 'short')).toBe(false);
    expect(sweepAllowed('Bearer a-long-enough-secret!', 'a-long-enough-secret')).toBe(false);
    expect(sweepAllowed('a-long-enough-secret', 'a-long-enough-secret')).toBe(false);
    expect(sweepAllowed('Bearer a-long-enough-secret', 'a-long-enough-secret')).toBe(true);
  });
});

/**
 * In Spanish (docs/i18n.md): each line is written in the language of the
 * press that caused it, and what the sweep writes with nobody's request to go
 * by (a hold ending, the reminder) in the language the room was frozen in.
 */
describe('Deal Freeze in Spanish', () => {
  async function frozenEs() {
    const t = await checkedOut({}, 'anon-freeze-es', 'es');
    const r = await freezeWith(t, { code: await codeFor(), locale: 'es' });
    if (!r.ok) throw new Error(r.error);
    return { ...t, userId: r.signedInAs!, booking: r.booking };
  }

  it('the booking keeps the language it was frozen in, and the chat says it was frozen in Spanish', async () => {
    const t = await frozenEs();
    expect(t.booking.locale).toBe('es');
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(
      `Congelado: ${t.hotel}, 11–13 dic, 2 noches, retenido hasta el 23 nov, 09:59 UTC. Referencia yzAvfyYq5. Confirma y paga antes, o se libera.`,
    );
  });

  it('kept and then cancelled, each line in Spanish', async () => {
    const t = await frozenEs();
    expect(await keepFrozen({ bookingId: t.booking.id, userId: t.userId, wallet: 'apple_pay', acceptedTotalMinor: t.booking.totalMinor, now: SOON, locale: 'es' })).toMatchObject({ ok: true });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Reservado: ${t.hotel}, 11–13 dic, 2 noches. Referencia yzAvfyYq5.`);
    expect(await cancelBooking({ bookingId: t.booking.id, supplier: t.supplier, locale: 'es' })).toMatchObject({ ok: true });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Cancelado: ${t.hotel}. Referencia yzAvfyYq5.`);
  });

  it('released by the guest in Spanish', async () => {
    const t = await frozenEs();
    expect(await releaseFrozen({ bookingId: t.booking.id, supplier: t.supplier, by: 'guest', now: SOON, locale: 'es' })).toMatchObject({ ok: true });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Liberado: ${t.hotel}. Referencia yzAvfyYq5. No se pagó nada.`);
  });

  it('a hold the sweep ends is said in the language it was frozen in, with no request to go by', async () => {
    const t = await frozenEs();
    expect(await sweepFreezes({ now: FROZEN_UNTIL, supplierFor: () => t.supplier })).toMatchObject({ released: 1 });
    expect((await listMessages(t.session.id)).at(-1)!.content).toBe(`Liberado: ${t.hotel}. Referencia yzAvfyYq5. No se pagó nada.`);
  });

  it('the reminder email is in Spanish, with Spanish money and dates', async () => {
    const t = await frozenEs();
    process.env.RESEND_API_KEY = 're_test';
    const sent: Array<{ subject: string; text: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 200 });
      }),
    );
    expect(await sweepFreezes({ now: t.booking.freezeReminderDueAt!, supplierFor: () => t.supplier })).toMatchObject({ remindersSent: 1 });
    const row = (await getBooking(t.booking.id))!;
    expect(sent[0].subject).toBe(`Tu habitación congelada en ${t.hotel} se libera el 23 nov, 09:59 UTC`);
    expect(sent[0].text.split('\n\n')).toEqual([
      `Congelaste ${t.hotel}, 11–13 dic, 2 noches, por ${formatMoney(row.totalMinor, row.currency, 'es')}.`,
      'Sigue reservada para ti hasta el 23 nov, 09:59 UTC. Para quedártela, abre Buscador de hoteles con la sesión iniciada con este correo, búscala en Tus reservas y confirma y paga antes.',
      'Si no haces nada, la cancelamos con el hotel en ese momento, antes de que termine su cancelación gratuita, y no se paga nada.',
      'Referencia yzAvfyYq5.',
    ]);
  });

  it('a booking from before the language was kept (null) is said in English', async () => {
    const t = await frozen();
    expect(reminderEmail({ ...t.booking, locale: null }).subject).toBe(`Your frozen room at ${t.hotel} is released 23 Nov, 09:59 UTC`);
  });

  it('a fee the supplier does not name is named in the page\'s language', () => {
    const fees = [
      { amount: { amountMinor: 300, currency: 'EUR' }, included: false },
      { amount: { amountMinor: 120, currency: 'EUR' }, included: true },
    ];
    expect(offerFees(fees, 'es').map((f) => f.description)).toEqual(['A pagar en el hotel', 'Impuestos y tasas']);
    expect(offerFees(fees).map((f) => f.description)).toEqual(['Paid at the hotel', 'Taxes and fees']);
  });
});

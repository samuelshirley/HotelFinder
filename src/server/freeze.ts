import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { bookedFreezeTerms, freezeTerms, holdEnded, MAX_ACTIVE_FREEZES } from '@/lib/freeze';
import { formatDates, formatMoney } from '@/lib/replies';
import { mailConfigured, sendEmail } from '@/server/auth/mailer';
import { guestNames, PRICE_CHECK_TTL_MS, signInGuest } from '@/server/checkout';
import { paymentMode, takePayment, type Wallet } from '@/server/payments';
import {
  claimReminder,
  countActiveFreezes,
  getBooking,
  listHoldsEnded,
  listReleasing,
  listRemindersDue,
  transitionBooking,
  unclaimReminder,
  type Booking,
} from '@/server/repos/bookings';
import { appendMessage } from '@/server/repos/chat';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * Deal Freeze (docs/deal-freeze.md): the free-cancellation rate is booked for
 * real, with no payment, and released at the supplier before the deadline
 * unless the guest keeps it and pays.
 *
 *   freeze  – prebooked → freezing (THE BOOK CLAIM: book is not idempotent;
 *             only the winner calls it, once) → frozen.
 *   keep    – frozen → keeping (the payment claim) → confirmed. No book call.
 *   release – frozen → releasing (the cancel claim) → cancelled. A cancel
 *             with no answer is read back, never sent blind again.
 *
 * Sandbox only: a live key would book on the business's own credit.
 */

const when = (d: Date) =>
  `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)} UTC`;

export type FreezeInput = {
  bookingId: string;
  signedInUserId: string | null;
  email: string;
  code: string;
  firstName: string;
  lastName: string;
  /** The total the page showed when Freeze was pressed. Must equal the checked price. */
  acceptedTotalMinor: number;
  supplier: SupplierAdapter;
  now: Date;
};

export type FreezeError =
  | 'booking_not_found'
  | 'booking_not_payable'
  | 'price_changed'
  | 'price_stale'
  | 'freeze_not_eligible'
  | 'name_missing'
  | 'freeze_unavailable'
  | 'email_invalid'
  | 'code_wrong'
  | 'code_expired'
  | 'freeze_limit'
  | 'booking_failed'
  | 'booking_unknown'
  | 'freeze_terms_changed';

export type FreezeResult = { ok: true; booking: Booking; signedInAs: string | null } | { ok: false; error: FreezeError; signedInAs: string | null };

export async function freezeBooking(input: FreezeInput): Promise<FreezeResult> {
  const { now } = input;
  const booking = await getBooking(input.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found', signedInAs: null };
  if (booking.status !== 'prebooked') return { ok: false, error: 'booking_not_payable', signedInAs: null };
  if (input.acceptedTotalMinor !== booking.totalMinor) return { ok: false, error: 'price_changed', signedInAs: null };
  const terms = freezeTerms(booking.cancellation, now);
  if (!terms.ok) return { ok: false, error: 'freeze_not_eligible', signedInAs: null };
  if (now.getTime() - booking.createdAt.getTime() > PRICE_CHECK_TTL_MS) return { ok: false, error: 'price_stale', signedInAs: null };
  const names = guestNames(input);
  if (!names) return { ok: false, error: 'name_missing', signedInAs: null };
  if (paymentMode() !== 'test') return { ok: false, error: 'freeze_unavailable', signedInAs: null };

  const guest = await signInGuest(input, now);
  if (!guest.ok) return { ok: false, error: guest.error, signedInAs: guest.signedInAs };
  const { signedInAs } = guest;
  if ((await countActiveFreezes(guest.userId)) >= MAX_ACTIVE_FREEZES) return { ok: false, error: 'freeze_limit', signedInAs };

  // THE CLAIM. Exactly one caller moves the row prebooked → freezing; only it books.
  const claimed = await transitionBooking(
    booking.id,
    'freezing',
    { userId: guest.userId, holderFirstName: names.firstName, holderLastName: names.lastName, holderEmail: guest.email, frozenUntil: terms.frozenUntil, freezeReminderDueAt: terms.reminderDueAt },
    'prebooked',
  );
  if (!claimed) return { ok: false, error: 'booking_not_payable', signedInAs };
  const holder = { firstName: names.firstName, lastName: names.lastName, email: guest.email };
  const result = await input.supplier.book({
    prebookId: booking.prebookId,
    transactionId: booking.transactionId,
    holder,
    guests: Array.from({ length: Math.max(1, booking.rooms ?? 1) }, () => holder),
    payment: 'sandbox_test',
  });
  if (!result.ok) {
    // No answer: the outcome is unknown, the row stays `freezing` and is never booked again.
    if (result.error.retryable) return { ok: false, error: 'booking_unknown', signedInAs };
    await transitionBooking(booking.id, 'failed', { failureCode: 'booking_failed' }, 'freezing');
    return { ok: false, error: 'booking_failed', signedInAs };
  }
  if (result.value.status !== 'confirmed') return { ok: false, error: 'booking_unknown', signedInAs };

  // The terms the hotel actually booked: the earlier deadline wins, and stricter terms are no freeze.
  const booked = bookedFreezeTerms(booking.cancellation, result.value.cancellation, now);
  const frozen = await transitionBooking(
    booking.id,
    'frozen',
    {
      supplierBookingId: result.value.supplierBookingId,
      hotelConfirmationCode: result.value.hotelConfirmationCode ?? undefined,
      ...(booked.ok ? { frozenUntil: booked.frozenUntil, freezeReminderDueAt: booked.reminderDueAt } : { frozenUntil: now, freezeReminderDueAt: null }),
    },
    'freezing',
  );
  if (!frozen) return { ok: false, error: 'booking_unknown', signedInAs };
  if (!booked.ok) {
    // A real booking that must not be held: released now (or by the next sweep if the hotel does not answer).
    await releaseFrozen({ bookingId: frozen.id, supplier: input.supplier, by: 'terms', now });
    return { ok: false, error: 'freeze_terms_changed', signedInAs };
  }
  if (frozen.sessionId && frozen.checkIn && frozen.checkOut && frozen.frozenUntil) {
    await appendMessage({
      sessionId: frozen.sessionId,
      role: 'assistant',
      kind: 'line',
      content: `Frozen: ${frozen.hotelName}, ${formatDates(frozen.checkIn, frozen.checkOut)}, held until ${when(frozen.frozenUntil)}. Reference ${frozen.supplierBookingId}. Confirm and pay before then, or it is released.`,
      meta: { booking: frozen.id },
    });
  }
  return { ok: true, booking: frozen, signedInAs };
}

export type KeepError = 'booking_not_found' | 'booking_not_payable' | 'freeze_expired' | 'price_changed' | 'payment_unavailable';

/** Confirm a frozen booking: the guest pays the held price. The room is already booked. */
export async function keepFrozen(input: { bookingId: string; userId: string; wallet: Wallet; acceptedTotalMinor: number; now: Date }): Promise<{ ok: true; booking: Booking } | { ok: false; error: KeepError }> {
  const booking = await getBooking(input.bookingId);
  if (!booking || booking.userId !== input.userId) return { ok: false, error: 'booking_not_found' };
  if (booking.status !== 'frozen') return { ok: false, error: 'booking_not_payable' };
  if (holdEnded(booking.frozenUntil, input.now)) return { ok: false, error: 'freeze_expired' };
  if (input.acceptedTotalMinor !== booking.totalMinor) return { ok: false, error: 'price_changed' };
  if (paymentMode() === 'none') return { ok: false, error: 'payment_unavailable' };

  // The payment claim: two presses cannot pay twice.
  const claimed = await transitionBooking(booking.id, 'keeping', { paidWith: input.wallet }, 'frozen');
  if (!claimed) return { ok: false, error: 'booking_not_payable' };
  const paid = await takePayment({ wallet: input.wallet, amountMinor: booking.totalMinor, currency: booking.currency });
  if (!paid.ok) {
    await transitionBooking(booking.id, 'frozen', { paidWith: null }, 'keeping');
    return { ok: false, error: paid.error };
  }
  const confirmed = await transitionBooking(booking.id, 'confirmed', { testPayment: paid.test }, 'keeping');
  if (!confirmed) return { ok: false, error: 'booking_not_payable' };
  if (confirmed.sessionId && confirmed.checkIn && confirmed.checkOut) {
    await appendMessage({
      sessionId: confirmed.sessionId,
      role: 'assistant',
      kind: 'line',
      content: `Booked: ${confirmed.hotelName}, ${formatDates(confirmed.checkIn, confirmed.checkOut)}. Reference ${confirmed.supplierBookingId}.`,
      meta: { booking: confirmed.id },
    });
  }
  return { ok: true, booking: confirmed };
}

export type ReleaseBy = 'guest' | 'expiry' | 'terms';
export type ReleaseError = 'booking_not_found' | 'not_cancellable' | 'cancel_failed' | 'release_unknown';

/** Release a frozen booking: cancelled at the supplier. Whoever moves it frozen → releasing cancels, once. */
export async function releaseFrozen(args: { bookingId: string; supplier: SupplierAdapter; by: ReleaseBy; now: Date }): Promise<{ ok: true; booking: Booking } | { ok: false; error: ReleaseError }> {
  const booking = await getBooking(args.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found' };
  if (booking.status !== 'frozen' || !booking.supplierBookingId) return { ok: false, error: 'not_cancellable' };
  const claimed = await transitionBooking(booking.id, 'releasing', { releasedBy: args.by }, 'frozen');
  if (!claimed) return { ok: false, error: 'not_cancellable' };
  const result = await args.supplier.cancel(booking.supplierBookingId);
  if (!result.ok) {
    if (result.error.retryable) return { ok: false, error: 'release_unknown' };
    // Refused: the room is still booked and still held; the guest or the sweep can release again.
    await transitionBooking(booking.id, 'frozen', { releasedBy: null }, 'releasing');
    return { ok: false, error: 'cancel_failed' };
  }
  if (result.value.status !== 'cancelled') return { ok: false, error: 'release_unknown' };
  return { ok: true, booking: await markReleased(claimed, result.value.refund.amountMinor, result.value.fee.amountMinor) };
}

async function markReleased(booking: Booking, refundMinor: number | null, feeMinor: number | null): Promise<Booking> {
  // A fee on a release means the hold outlived the free-cancellation window: a cost to the business.
  if (feeMinor) console.error('[freeze] released with a cancellation fee', booking.id, feeMinor);
  const cancelled = await transitionBooking(booking.id, 'cancelled', { refundMinor, cancelFeeMinor: feeMinor }, 'releasing');
  if (cancelled?.sessionId) {
    await appendMessage({
      sessionId: cancelled.sessionId,
      role: 'assistant',
      kind: 'line',
      content: `Released: ${cancelled.hotelName}. Reference ${cancelled.supplierBookingId}. Nothing was paid.`,
      meta: { booking: cancelled.id },
    });
  }
  return cancelled ?? booking;
}

/**
 * A release the supplier did not answer: read the booking back. Cancelled →
 * cancelled. Still confirmed → frozen again, so it can be released again.
 * Anything else stays as it is.
 */
export async function resolveReleasing(booking: Booking, supplier: SupplierAdapter): Promise<Booking | null> {
  if (booking.status !== 'releasing' || !booking.supplierBookingId) return null;
  const read = await supplier.getBooking(booking.supplierBookingId);
  if (!read.ok) return null;
  if (read.value.status === 'cancelled') return markReleased(booking, null, null);
  if (read.value.status === 'confirmed') return transitionBooking(booking.id, 'frozen', { releasedBy: null }, 'releasing');
  return null;
}

/** For a booking being looked at: a hold that has ended is released now. */
export async function settleFreeze(booking: Booking, supplier: SupplierAdapter, now: Date): Promise<Booking> {
  if (booking.status === 'frozen' && holdEnded(booking.frozenUntil, now)) {
    const released = await releaseFrozen({ bookingId: booking.id, supplier, by: 'expiry', now });
    return released.ok ? released.booking : ((await getBooking(booking.id)) ?? booking);
  }
  if (booking.status === 'releasing') return (await resolveReleasing(booking, supplier)) ?? booking;
  return booking;
}

export function reminderEmail(b: Booking): { subject: string; text: string } {
  const until = b.frozenUntil ? when(b.frozenUntil) : 'soon';
  const dates = b.checkIn && b.checkOut ? `, ${formatDates(b.checkIn, b.checkOut)}` : '';
  return {
    subject: `Your frozen room at ${b.hotelName} is released ${until}`,
    text: [
      `You froze ${b.hotelName}${dates}, at ${formatMoney(b.totalMinor, b.currency)}.`,
      `It stays booked for you until ${until}. To keep it, open Hotel finder signed in with this email, find it under Your bookings, and confirm and pay before then.`,
      `If you do nothing, we cancel it with the hotel at that time, before its free-cancellation deadline, and nothing is paid.`,
      `Reference ${b.supplierBookingId}.`,
    ].join('\n\n'),
  };
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** True only for `Authorization: Bearer <CRON_SECRET>`. With no secret (or a short one) set, nobody may run the sweep. */
export function sweepAllowed(authorization: string | null, secret = process.env.CRON_SECRET ?? ''): boolean {
  if (secret.length < 16 || !authorization) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

export type SweepReport = { released: number; releaseFailed: number; resolved: number; remindersSent: number; remindersDisplayOnly: number };

/**
 * The scheduled pass: release every ended hold, read back unanswered
 * releases, send due reminders. Safe to run twice at once: every step is a
 * claim on the row.
 */
export async function sweepFreezes(args: { now: Date; supplierFor: (b: Booking) => SupplierAdapter }): Promise<SweepReport> {
  const report: SweepReport = { released: 0, releaseFailed: 0, resolved: 0, remindersSent: 0, remindersDisplayOnly: 0 };
  for (const b of await listHoldsEnded(args.now)) {
    const r = await releaseFrozen({ bookingId: b.id, supplier: args.supplierFor(b), by: 'expiry', now: args.now });
    if (r.ok) report.released += 1;
    else report.releaseFailed += 1;
  }
  for (const b of await listReleasing()) {
    if (await resolveReleasing(b, args.supplierFor(b))) report.resolved += 1;
  }
  const due = await listRemindersDue(args.now);
  if (!mailConfigured()) {
    // No mail service here: the reminder is on the booking page only.
    report.remindersDisplayOnly = due.length;
    return report;
  }
  for (const b of due) {
    if (!b.holderEmail || !(await claimReminder(b.id, args.now))) continue;
    const { subject, text } = reminderEmail(b);
    if (await sendEmail(b.holderEmail, subject, text)) report.remindersSent += 1;
    else await unclaimReminder(b.id);
  }
  return report;
}

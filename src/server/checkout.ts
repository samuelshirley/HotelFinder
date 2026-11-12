import 'server-only';

import type { CancellationPolicy, SupplierAdapter } from '@/server/supplier';
import { formatDates } from '@/lib/replies';
import { normalizeEmail, verifyCode } from '@/server/auth/otp';
import { userForVerifiedEmail } from '@/server/auth/user';
import { paymentMode, takePayment, type Wallet } from '@/server/payments';
import { createPrebooked, getBooking, transitionBooking, type Booking } from '@/server/repos/bookings';
import { appendMessage } from '@/server/repos/chat';
import { getOffer } from '@/server/repos/offers';
import { getProperty } from '@/server/repos/properties';
import { isMemberOnlyPrice } from '@/lib/pricing';
import { audienceFor, getStay, type SearchSession } from '@/server/repos/sessions';

/**
 * Booking, in the order money demands:
 *
 *   1. start   – the supplier re-checks the rate (prebook) and the booking row
 *                is written BEFORE any payment sheet opens.
 *   2. confirm – one press: the email code signs the guest in, the payment is
 *                taken for exactly the price the guest was shown, the row is
 *                claimed paid → booking, and only the claimant calls book.
 *   3. cancel  – through the supplier; the refund is what the supplier says.
 */

/** A price check older than this is checked again before anyone pays it. */
export const PRICE_CHECK_TTL_MS = 20 * 60_000;

export type StartError = 'property_not_found' | 'rate_gone' | 'supplier_unavailable';

export async function startCheckout(args: { session: SearchSession; offerId: string; supplier: SupplierAdapter }): Promise<{ ok: true; booking: Booking } | { ok: false; error: StartError }> {
  const { session, supplier } = args;
  const offer = await getOffer(args.offerId, session.id, audienceFor(session));
  // A member price is never sold to an anonymous visitor, even by its id.
  if (!offer || isMemberOnlyPrice(offer, audienceFor(session))) return { ok: false, error: 'property_not_found' };
  const [stay, property] = await Promise.all([getStay(offer.stayId, session.id), getProperty(offer.propertyId)]);
  if (!stay || !property) return { ok: false, error: 'property_not_found' };

  const check = await supplier.recheckRate(offer.supplierOfferId);
  if (!check.ok) return { ok: false, error: check.error.retryable ? 'supplier_unavailable' : 'rate_gone' };

  const booking = await createPrebooked({
    userId: session.userId,
    sessionId: session.id,
    offerId: offer.id,
    supplier: offer.supplier,
    prebookId: check.value.prebookId,
    transactionId: check.value.transactionId,
    currency: check.value.total.currency,
    totalMinor: check.value.total.amountMinor,
    // A quote in another currency cannot be compared: it is shown as a change.
    quotedTotalMinor: check.value.total.currency === offer.currency ? offer.totalMinor : -1,
    propertyId: property.id,
    hotelName: property.name,
    roomName: offer.roomName,
    boardName: offer.boardName,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: stay.adults,
    childrenAges: stay.childrenAges,
    rooms: stay.rooms,
    payAtPropertyMinor: offer.payAtPropertyMinor,
    cancellation: (check.value.cancellation ?? offer.cancellation) as Record<string, unknown> | null,
  });
  return { ok: true, booking };
}

export type ConfirmInput = {
  bookingId: string;
  /** Null when the browser is not signed in: then email and code are required. */
  signedInUserId: string | null;
  email: string;
  code: string;
  firstName: string;
  lastName: string;
  wallet: Wallet;
  /** The total the page showed when the wallet was pressed. Must equal the checked price. */
  acceptedTotalMinor: number;
  supplier: SupplierAdapter;
  now: Date;
};

export type ConfirmError =
  | 'booking_not_found'
  | 'booking_not_payable'
  | 'price_changed'
  | 'price_stale'
  | 'name_missing'
  | 'email_invalid'
  | 'code_wrong'
  | 'code_expired'
  | 'payment_unavailable'
  | 'booking_failed'
  | 'booking_unknown';

export type ConfirmResult = { ok: true; booking: Booking; signedInAs: string | null } | { ok: false; error: ConfirmError; signedInAs: string | null };

const NAME = /^[\p{L}][\p{L}\p{M}' .-]{0,59}$/u;
const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

export async function confirmCheckout(input: ConfirmInput): Promise<ConfirmResult> {
  const { now } = input;
  const booking = await getBooking(input.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found', signedInAs: null };
  if (booking.status !== 'prebooked') return { ok: false, error: 'booking_not_payable', signedInAs: null };
  // Only the price the guest saw can be paid: a changed price needs a fresh press.
  if (input.acceptedTotalMinor !== booking.totalMinor) return { ok: false, error: 'price_changed', signedInAs: null };
  if (now.getTime() - booking.createdAt.getTime() > PRICE_CHECK_TTL_MS) return { ok: false, error: 'price_stale', signedInAs: null };
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!NAME.test(firstName) || !NAME.test(lastName)) return { ok: false, error: 'name_missing', signedInAs: null };
  if (paymentMode() === 'none') return { ok: false, error: 'payment_unavailable', signedInAs: null };

  // Sign in first: a wrong code stops here, before any payment.
  let userId = input.signedInUserId;
  let email: string;
  let signedInAs: string | null = null;
  if (userId) {
    email = normalizeEmail(input.email) ?? '';
  } else {
    const normalized = normalizeEmail(input.email);
    if (!normalized) return { ok: false, error: 'email_invalid', signedInAs: null };
    const verified = await verifyCode(normalized, input.code.trim(), now);
    if (!verified.ok) return { ok: false, error: verified.error, signedInAs: null };
    const user = await userForVerifiedEmail(normalized, now);
    userId = user.id;
    email = normalized;
    signedInAs = user.id;
  }
  if (!email) return { ok: false, error: 'email_invalid', signedInAs };

  const pending = await transitionBooking(booking.id, 'payment_pending', { userId, holderFirstName: firstName, holderLastName: lastName, holderEmail: email, paidWith: input.wallet });
  if (!pending) return { ok: false, error: 'booking_not_payable', signedInAs };
  const paid = await takePayment({ wallet: input.wallet, amountMinor: booking.totalMinor, currency: booking.currency });
  if (!paid.ok) {
    await transitionBooking(booking.id, 'failed', { failureCode: paid.error });
    return { ok: false, error: paid.error, signedInAs };
  }
  if (!(await transitionBooking(booking.id, 'paid', { testPayment: paid.test }))) return { ok: false, error: 'booking_not_payable', signedInAs };

  const booked = await bookPaid({ booking, guest: { firstName, lastName, email }, test: paid.test, supplier: input.supplier });
  if (!booked.ok) return { ok: false, error: booked.error, signedInAs };
  const confirmed = booked.booking;
  if (booking.sessionId && booking.checkIn && booking.checkOut) {
    await appendMessage({
      sessionId: booking.sessionId,
      role: 'assistant',
      kind: 'line',
      content: `Booked: ${booking.hotelName}, ${formatDates(booking.checkIn, booking.checkOut)}. Reference ${confirmed.supplierBookingId}.`,
      meta: { booking: booking.id },
    });
  }
  return { ok: true, booking: confirmed, signedInAs };
}

/**
 * A paid booking to the supplier. THE CLAIM: book is not idempotent at the
 * supplier (a second call books a second room), so only whoever moves the row
 * paid → booking calls it, once. Also the entry point for a payment confirmed
 * out of band (the real wallet path), which is why it re-reads nothing.
 */
export async function bookPaid(args: {
  booking: Booking;
  guest: { firstName: string; lastName: string; email: string };
  test: boolean;
  supplier: SupplierAdapter;
}): Promise<{ ok: true; booking: Booking } | { ok: false; error: 'booking_not_payable' | 'booking_failed' | 'booking_unknown' }> {
  const { booking, guest } = args;
  const claimed = await transitionBooking(booking.id, 'booking');
  if (!claimed) return { ok: false, error: 'booking_not_payable' };
  const result = await args.supplier.book({
    prebookId: booking.prebookId,
    transactionId: booking.transactionId,
    holder: guest,
    guests: Array.from({ length: Math.max(1, booking.rooms ?? 1) }, () => guest),
    payment: args.test ? 'sandbox_test' : 'transaction_id',
  });
  if (!result.ok) {
    // A timeout or a dropped connection leaves the outcome unknown: the row stays
    // in `booking` and is never booked again. A refusal is final.
    if (result.error.retryable) return { ok: false, error: 'booking_unknown' };
    await transitionBooking(booking.id, 'failed', { failureCode: 'booking_failed' });
    return { ok: false, error: 'booking_failed' };
  }
  if (result.value.status !== 'confirmed') return { ok: false, error: 'booking_unknown' };
  const confirmed = await transitionBooking(booking.id, 'confirmed', {
    supplierBookingId: result.value.supplierBookingId,
    hotelConfirmationCode: result.value.hotelConfirmationCode ?? undefined,
  });
  return confirmed ? { ok: true, booking: confirmed } : { ok: false, error: 'booking_unknown' };
}

export type CancelError = 'booking_not_found' | 'not_cancellable' | 'cancel_failed';

export async function cancelBooking(args: { bookingId: string; supplier: SupplierAdapter }): Promise<{ ok: true; booking: Booking } | { ok: false; error: CancelError }> {
  const booking = await getBooking(args.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found' };
  if (booking.status !== 'confirmed' || !booking.supplierBookingId) return { ok: false, error: 'not_cancellable' };
  const result = await args.supplier.cancel(booking.supplierBookingId);
  if (!result.ok || result.value.status !== 'cancelled') return { ok: false, error: 'cancel_failed' };
  const cancelled = await transitionBooking(booking.id, 'cancelled', { refundMinor: result.value.refund.amountMinor, cancelFeeMinor: result.value.fee.amountMinor });
  if (booking.sessionId) {
    await appendMessage({ sessionId: booking.sessionId, role: 'assistant', kind: 'line', content: `Cancelled: ${booking.hotelName}. Reference ${booking.supplierBookingId}.`, meta: { booking: booking.id } });
  }
  return { ok: true, booking: cancelled ?? booking };
}

/** What the checkout and receipt page shows. Supplier ids stay on the server except the booking reference. */
export function bookingView(b: Booking, now: Date) {
  const cancellation = b.cancellation as Partial<CancellationPolicy> | null;
  return {
    id: b.id,
    sessionId: b.sessionId,
    status: b.status,
    hotelName: b.hotelName,
    roomName: b.roomName,
    boardName: b.boardName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    adults: b.adults,
    childrenAges: b.childrenAges ?? [],
    rooms: b.rooms,
    currency: b.currency,
    totalMinor: b.totalMinor,
    /** null when the card's price was in another currency and cannot be compared. */
    quotedTotalMinor: b.quotedTotalMinor >= 0 ? b.quotedTotalMinor : null,
    priceChanged: b.quotedTotalMinor !== b.totalMinor,
    payAtPropertyMinor: b.payAtPropertyMinor ?? 0,
    refundable: cancellation?.refundable ?? null,
    freeCancellationUntil: cancellation?.freeCancellationUntil ?? null,
    checkedAt: b.createdAt.toISOString(),
    priceCheckStale: b.status === 'prebooked' && now.getTime() - b.createdAt.getTime() > PRICE_CHECK_TTL_MS,
    reference: b.supplierBookingId,
    hotelConfirmationCode: b.hotelConfirmationCode,
    holder: b.holderFirstName ? { firstName: b.holderFirstName, lastName: b.holderLastName, email: b.holderEmail } : null,
    paidWith: b.paidWith,
    testPayment: b.testPayment,
    failureCode: b.failureCode,
    refundMinor: b.refundMinor,
    cancelFeeMinor: b.cancelFeeMinor,
    offerId: b.offerId,
  };
}
export type BookingView = ReturnType<typeof bookingView>;

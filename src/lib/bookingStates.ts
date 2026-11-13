import type { BookingStatus } from '@/server/db/schema';

/**
 * Which booking status may follow which. Pure; the repo applies it as the
 * WHERE clause of the update, so an illegal move changes zero rows.
 *
 * `paid → booking` is a CLAIM: exactly one caller wins it, and only the
 * winner may call the supplier's book endpoint. The supplier does not
 * de-duplicate a repeated book for the same prebook, it books again.
 *
 * A row left in `booking` (the call timed out, the process died) has an
 * unknown outcome. It is resolved by reading the booking back from the
 * supplier, never by calling book a second time.
 *
 * `failed` is reachable from every state before `confirmed`: the supplier can
 * refuse at prebook, the card can fail, and book can fail after the payment
 * cleared (the hold then releases on the supplier's side).
 *
 * Deal Freeze (docs/deal-freeze.md) books BEFORE payment, so it has its own
 * claims, each won by exactly one caller:
 *   prebooked → freezing  the book claim; the winner calls book, once.
 *   frozen    → keeping   the payment claim; no book call (already booked).
 *   frozen    → releasing the cancel claim; the winner calls cancel.
 * A refused payment or cancel returns the row to `frozen`: the room is still
 * booked. A cancel with no answer stays `releasing` and is read back.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  prebooked: ['payment_pending', 'freezing', 'failed'],
  payment_pending: ['paid', 'failed'],
  paid: ['booking', 'failed'],
  booking: ['confirmed', 'failed'],
  confirmed: ['cancelled'],
  failed: [],
  cancelled: [],
  freezing: ['frozen', 'failed'],
  frozen: ['keeping', 'releasing'],
  keeping: ['confirmed', 'frozen'],
  releasing: ['cancelled', 'frozen'],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** Every status from which `to` is a legal next step. */
export function sourcesFor(to: BookingStatus): BookingStatus[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingStatus[]).filter((from) => canTransition(from, to));
}

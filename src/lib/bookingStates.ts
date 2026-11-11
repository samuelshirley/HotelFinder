import type { BookingStatus } from '@/server/db/schema';

/**
 * Which booking status may follow which. Pure; the repo applies it as the
 * WHERE clause of the update, so an illegal move changes zero rows.
 *
 * `failed` is reachable from every state before `confirmed`: the supplier can
 * refuse at prebook, the card can fail, and book can fail after the payment
 * cleared (the hold then releases on the supplier's side).
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  prebooked: ['payment_pending', 'failed'],
  payment_pending: ['paid', 'failed'],
  paid: ['confirmed', 'failed'],
  confirmed: ['cancelled'],
  failed: [],
  cancelled: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** Every status from which `to` is a legal next step. */
export function sourcesFor(to: BookingStatus): BookingStatus[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingStatus[]).filter((from) => canTransition(from, to));
}

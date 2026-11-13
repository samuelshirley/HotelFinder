/**
 * Deal Freeze terms, pure (docs/deal-freeze.md). A freeze is a real booking
 * of a free-cancellation rate, released at the supplier before the deadline
 * unless the guest keeps it. These numbers decide when.
 */

const HOUR = 3_600_000;

/**
 * The hold ends this long before the free-cancellation deadline, so a daily
 * sweep that misses one run still releases before the hotel would charge.
 */
export const RELEASE_MARGIN_MS = 48 * HOUR;
/** A hold shorter than this is not offered: there is no time to decide. */
export const MIN_HOLD_MS = 24 * HOUR;
/** The reminder is due this long before the hold ends (or at once, for a shorter hold). */
export const REMINDER_BEFORE_MS = 24 * HOUR;
/** Frozen bookings one account may hold at once. */
export const MAX_ACTIVE_FREEZES = 3;

export type FreezePolicy = { refundable?: boolean | null; freeCancellationUntil?: string | null } | null | undefined;

export type FreezeTerms =
  | { ok: true; frozenUntil: Date; reminderDueAt: Date; freeCancellationUntil: Date }
  | { ok: false; reason: 'not_refundable' | 'no_deadline' | 'too_late' };

/** Whether a rate with this cancellation policy can be frozen at `now`, and until when. */
export function freezeTerms(policy: FreezePolicy, now: Date): FreezeTerms {
  if (!policy || policy.refundable !== true) return { ok: false, reason: 'not_refundable' };
  const deadline = policy.freeCancellationUntil ? Date.parse(policy.freeCancellationUntil) : NaN;
  // A refundable rate without a stated deadline cannot be frozen: we would be guessing when it starts to cost.
  if (!Number.isFinite(deadline)) return { ok: false, reason: 'no_deadline' };
  const until = deadline - RELEASE_MARGIN_MS;
  if (until - now.getTime() < MIN_HOLD_MS) return { ok: false, reason: 'too_late' };
  return {
    ok: true,
    frozenUntil: new Date(until),
    reminderDueAt: new Date(Math.max(now.getTime(), until - REMINDER_BEFORE_MS)),
    freeCancellationUntil: new Date(deadline),
  };
}

/**
 * The terms of the booking the supplier actually made, checked against the
 * ones it was frozen on: the earlier deadline wins, and a booking that came
 * back non-refundable, or too close to its deadline, is not a freeze.
 */
export function bookedFreezeTerms(atPrebook: FreezePolicy, atBook: FreezePolicy, now: Date): FreezeTerms {
  const first = freezeTerms(atPrebook, now);
  if (!atBook) return first;
  const second = freezeTerms(atBook, now);
  if (!first.ok) return first;
  if (!second.ok) return second;
  return first.frozenUntil.getTime() <= second.frozenUntil.getTime() ? first : second;
}

/** True once the hold has ended and the booking must be released. */
export const holdEnded = (frozenUntil: Date | null, now: Date): boolean => frozenUntil !== null && frozenUntil.getTime() <= now.getTime();

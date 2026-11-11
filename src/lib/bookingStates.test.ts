import { describe, expect, it } from 'vitest';
import { BOOKING_STATUSES } from '@/server/db/schema';
import { BOOKING_TRANSITIONS, canTransition, sourcesFor } from './bookingStates';

describe('booking states', () => {
  it('covers every status the schema knows', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it('nothing leaves a terminal state', () => {
    expect(BOOKING_TRANSITIONS.failed).toEqual([]);
    expect(BOOKING_TRANSITIONS.cancelled).toEqual([]);
  });

  it('confirmed is reachable only through the booking claim, and the claim only from paid', () => {
    expect(sourcesFor('confirmed')).toEqual(['booking']);
    expect(sourcesFor('booking')).toEqual(['paid']);
    expect(sourcesFor('paid')).toEqual(['payment_pending']);
  });

  it('failure is possible until the booking is confirmed, not after', () => {
    expect(sourcesFor('failed').sort()).toEqual(['booking', 'paid', 'payment_pending', 'prebooked']);
    expect(canTransition('confirmed', 'failed')).toBe(false);
  });

  it('no status can be re-entered', () => {
    for (const s of BOOKING_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

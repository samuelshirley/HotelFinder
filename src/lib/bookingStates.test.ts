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

  it('confirmed is reachable only through a book claim: paid booking, or a frozen one kept', () => {
    expect(sourcesFor('confirmed').sort()).toEqual(['booking', 'keeping']);
    expect(sourcesFor('booking')).toEqual(['paid']);
    expect(sourcesFor('paid')).toEqual(['payment_pending']);
    expect(sourcesFor('keeping')).toEqual(['frozen']);
  });

  it('a freeze is booked only by the freezing claim, taken only from a fresh prebook', () => {
    expect(sourcesFor('freezing')).toEqual(['prebooked']);
    expect(sourcesFor('frozen').sort()).toEqual(['freezing', 'keeping', 'releasing']);
  });

  it('a frozen booking is never re-booked: nothing leads back to a book claim', () => {
    for (const s of ['frozen', 'keeping', 'releasing'] as const) {
      expect(canTransition(s, 'booking')).toBe(false);
      expect(canTransition(s, 'freezing')).toBe(false);
      expect(canTransition(s, 'paid')).toBe(false);
    }
  });

  it('a frozen booking is cancelled only through the release claim', () => {
    expect(sourcesFor('releasing')).toEqual(['frozen']);
    expect(sourcesFor('cancelled').sort()).toEqual(['confirmed', 'releasing']);
    // A frozen booking exists at the supplier: it can be released, not marked failed.
    expect(canTransition('frozen', 'failed')).toBe(false);
  });

  it('failure is possible until the booking is confirmed or frozen, not after', () => {
    expect(sourcesFor('failed').sort()).toEqual(['booking', 'freezing', 'paid', 'payment_pending', 'prebooked']);
    expect(canTransition('confirmed', 'failed')).toBe(false);
  });

  it('no status can be re-entered', () => {
    for (const s of BOOKING_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

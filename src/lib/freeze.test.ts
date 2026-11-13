import { describe, expect, it } from 'vitest';

import { bookedFreezeTerms, freezeTerms, holdEnded, MIN_HOLD_MS, RELEASE_MARGIN_MS, REMINDER_BEFORE_MS } from './freeze';

const H = 3_600_000;
const NOW = new Date('2026-11-13T12:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * H).toISOString();
const refundable = (hoursFromNow: number) => ({ refundable: true, freeCancellationUntil: at(hoursFromNow) });

describe('freeze terms', () => {
  it('holds until the margin before the free-cancellation deadline, reminder a day before that', () => {
    const t = freezeTerms(refundable(240), NOW);
    expect(t).toEqual({
      ok: true,
      frozenUntil: new Date(NOW.getTime() + 240 * H - RELEASE_MARGIN_MS),
      reminderDueAt: new Date(NOW.getTime() + 240 * H - RELEASE_MARGIN_MS - REMINDER_BEFORE_MS),
      freeCancellationUntil: new Date(at(240)),
    });
    // The hold always ends before the hotel starts charging.
    if (t.ok) expect(t.frozenUntil.getTime()).toBeLessThan(Date.parse(at(240)));
  });

  it('a hold shorter than the minimum is not offered; exactly the minimum is', () => {
    const edge = (RELEASE_MARGIN_MS + MIN_HOLD_MS) / H;
    expect(freezeTerms(refundable(edge), NOW)).toMatchObject({ ok: true });
    expect(freezeTerms(refundable(edge - 0.01), NOW)).toEqual({ ok: false, reason: 'too_late' });
    expect(freezeTerms(refundable(1), NOW)).toEqual({ ok: false, reason: 'too_late' });
    expect(freezeTerms(refundable(-5), NOW)).toEqual({ ok: false, reason: 'too_late' });
  });

  it('the reminder is never due in the past, and never after the hold ends', () => {
    for (const hours of [(RELEASE_MARGIN_MS + MIN_HOLD_MS) / H, (RELEASE_MARGIN_MS + MIN_HOLD_MS) / H + 1, 400]) {
      const t = freezeTerms(refundable(hours), NOW);
      if (!t.ok) throw new Error('expected freezable');
      expect(t.reminderDueAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
      expect(t.reminderDueAt.getTime()).toBeLessThan(t.frozenUntil.getTime());
    }
  });

  it('non-refundable, unknown, or refundable without a deadline: not freezable', () => {
    expect(freezeTerms({ refundable: false, freeCancellationUntil: at(500) }, NOW)).toEqual({ ok: false, reason: 'not_refundable' });
    expect(freezeTerms({ refundable: null, freeCancellationUntil: at(500) }, NOW)).toEqual({ ok: false, reason: 'not_refundable' });
    expect(freezeTerms(null, NOW)).toEqual({ ok: false, reason: 'not_refundable' });
    expect(freezeTerms({ refundable: true, freeCancellationUntil: null }, NOW)).toEqual({ ok: false, reason: 'no_deadline' });
    expect(freezeTerms({ refundable: true, freeCancellationUntil: 'not a date' }, NOW)).toEqual({ ok: false, reason: 'no_deadline' });
  });

  it('the booked terms: the earlier deadline wins; stricter terms are no freeze; none given keeps the checked ones', () => {
    const early = bookedFreezeTerms(refundable(300), refundable(200), NOW);
    expect(early.ok && early.freeCancellationUntil.toISOString()).toBe(at(200));
    const late = bookedFreezeTerms(refundable(200), refundable(300), NOW);
    expect(late.ok && late.freeCancellationUntil.toISOString()).toBe(at(200));
    expect(bookedFreezeTerms(refundable(300), { refundable: false, freeCancellationUntil: null }, NOW)).toEqual({ ok: false, reason: 'not_refundable' });
    expect(bookedFreezeTerms(refundable(300), refundable(10), NOW)).toEqual({ ok: false, reason: 'too_late' });
    expect(bookedFreezeTerms(refundable(300), null, NOW)).toEqual(freezeTerms(refundable(300), NOW));
  });

  it('the hold has ended at its instant, not before', () => {
    const until = new Date(at(5));
    expect(holdEnded(until, new Date(until.getTime() - 1))).toBe(false);
    expect(holdEnded(until, until)).toBe(true);
    expect(holdEnded(null, NOW)).toBe(false);
  });
});

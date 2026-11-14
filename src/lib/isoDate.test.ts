import { describe, expect, it } from 'vitest';

import { mentionsDates } from './placePick';
import { isoDate, isRealDate } from './isoDate';
import { actionSchema } from './store/actions';
import { validateScan } from './scannedTrip';

/** An impossible date is invalid_request at the boundary; in chat it is a typo and the dates are asked again (Sam, 2026-11-14). */
describe('a calendar date that exists', () => {
  it('takes real dates, leap days included', () => {
    for (const d of ['2026-12-11', '2026-12-31', '2028-02-29', '2000-02-29', '2027-01-01']) expect(isRealDate(d), d).toBe(true);
  });

  it('refuses dates that do not exist and anything not YYYY-MM-DD', () => {
    for (const d of ['2026-12-40', '2026-13-01', '2026-00-10', '2026-12-00', '2027-02-29', '1900-02-29', '2026-04-31', '2026-1-1', '2026-12-11T00:00', ' 2026-12-11', '']) expect(isRealDate(d), d).toBe(false);
  });

  it('is the schema every typed date goes through: set_dates with 40 December is not an action', () => {
    expect(isoDate.safeParse('2026-12-40').success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_dates', checkIn: '2026-12-38', checkOut: '2026-12-40' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-13' }).success).toBe(true);
  });

  it('in chat, a typo date is dropped from the scan and the words still talk about when, so the dates are asked', () => {
    const text = 'Porto 38 to 40 December';
    expect(validateScan({ destination: 'Porto', check_in: '2026-12-38', check_out: '2026-12-40' }, '2026-11-14', 'EUR')).toEqual({ destination: 'Porto' });
    expect(mentionsDates(text)).toBe(true);
  });
});

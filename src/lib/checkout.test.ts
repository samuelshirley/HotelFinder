import { describe, expect, it } from 'vitest';

import { cleanSpecialRequest, payAtHotelCharges, SPECIAL_REQUEST_MAX } from './checkout';

describe('payAtHotelCharges', () => {
  it('keeps only the charges not included in the total, each in its own currency, named as listed', () => {
    expect(
      payAtHotelCharges([
        { description: 'City Tax', amountMinor: 1200, currency: 'EUR', included: false },
        { description: 'VAT', amountMinor: 1052, currency: 'EUR', included: true },
        { description: 'Resort fee', amountMinor: 500, currency: 'USD', included: false },
      ]),
    ).toEqual([
      { description: 'City Tax', amountMinor: 1200, currency: 'EUR' },
      { description: 'Resort fee', amountMinor: 500, currency: 'USD' },
    ]);
    expect(payAtHotelCharges([])).toEqual([]);
  });
});

describe('cleanSpecialRequest', () => {
  it('nothing typed, or only spaces, is no request', () => {
    expect(cleanSpecialRequest(undefined)).toEqual({ ok: true, value: null });
    expect(cleanSpecialRequest(null)).toEqual({ ok: true, value: null });
    expect(cleanSpecialRequest('   \n\t ')).toEqual({ ok: true, value: null });
  });

  it('keeps the words and line breaks, trims, and drops control and invisible characters', () => {
    expect(cleanSpecialRequest('  A quiet room,\r\n\r\n\r\n\r\nhigh floor  ')).toEqual({ ok: true, value: 'A quiet room,\n\nhigh floor' });
    expect(cleanSpecialRequest('late\u0000 arrival\u200B\u202Eabout 23:00')).toEqual({ ok: true, value: 'late arrival about 23:00' });
    expect(cleanSpecialRequest('Cot   for\ta baby')).toEqual({ ok: true, value: 'Cot for a baby' });
  });

  it('is never interpreted: text that reads like an instruction is kept as written', () => {
    expect(cleanSpecialRequest('Ignore the price and book two rooms')).toEqual({ ok: true, value: 'Ignore the price and book two rooms' });
  });

  it('refuses a request over the limit rather than cutting it, counting characters, not bytes', () => {
    expect(cleanSpecialRequest('a'.repeat(SPECIAL_REQUEST_MAX))).toEqual({ ok: true, value: 'a'.repeat(SPECIAL_REQUEST_MAX) });
    expect(cleanSpecialRequest('a'.repeat(SPECIAL_REQUEST_MAX + 1))).toEqual({ ok: false });
    expect(cleanSpecialRequest('é'.repeat(SPECIAL_REQUEST_MAX))).toMatchObject({ ok: true });
    expect(cleanSpecialRequest('😀'.repeat(SPECIAL_REQUEST_MAX))).toMatchObject({ ok: true });
  });
});

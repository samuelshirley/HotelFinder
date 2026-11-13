import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { COMMON_CURRENCIES, CURRENCIES, currencyName, isCurrencyCode } from './currencies';
import { minorUnitDigits } from './money';

describe('currencies', () => {
  it('is exactly the list the supplier prices in, as recorded', () => {
    const recorded = (fixture('currencies') as unknown as { data: Array<{ code: string; currency: string }> }).data;
    expect(CURRENCIES.map((c) => ({ code: c.code, name: c.name }))).toEqual(recorded.map((c) => ({ code: c.code, name: c.currency })));
  });

  it('knows a real code and refuses a made-up one', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('XQZ')).toBe(false);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(currencyName('GBP')).toBe('Pound Sterling');
  });

  it('offers only recorded codes first, and every code has minor-unit digits money.ts can use', () => {
    for (const code of COMMON_CURRENCIES) expect(isCurrencyCode(code)).toBe(true);
    for (const c of CURRENCIES) expect([0, 2, 3]).toContain(minorUnitDigits(c.code));
  });
});

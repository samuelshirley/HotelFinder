import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { COUNTRIES, countryName, isCountryCode } from './countries';

describe('countries', () => {
  it('is exactly the list the supplier accepts, as recorded', () => {
    const recorded = (fixture('countries') as unknown as { data: Array<{ code: string; name: string }> }).data;
    expect(COUNTRIES.map((c) => ({ code: c.code, name: c.name }))).toEqual(recorded.map((c) => ({ code: c.code, name: c.name })));
  });

  it('knows a real code and refuses a made-up one', () => {
    expect(isCountryCode('ES')).toBe(true);
    expect(isCountryCode('ZZ')).toBe(false);
    expect(isCountryCode('es')).toBe(false);
    expect(countryName('PT')).toBe('Portugal');
  });
});

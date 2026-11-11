import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { inferNationality, regionFromAcceptLanguage } from './nationality';

const none = { saved: null, acceptLanguage: null, ipCountry: null, destinationCountry: null };

describe('inferring the nationality for rates', () => {
  it('first hit wins: saved, then browser, then IP, then the destination', () => {
    const all = { saved: 'PT', acceptLanguage: 'en-US,en;q=0.9', ipCountry: 'ES', destinationCountry: 'FR' };
    expect(inferNationality(all)).toEqual({ code: 'PT', source: 'saved' });
    expect(inferNationality({ ...all, saved: null })).toEqual({ code: 'US', source: 'browser' });
    expect(inferNationality({ ...all, saved: null, acceptLanguage: 'en' })).toEqual({ code: 'ES', source: 'ip' });
    expect(inferNationality({ ...none, destinationCountry: 'FR' })).toEqual({ code: 'FR', source: 'destination' });
    expect(inferNationality(none)).toBeNull();
  });

  it('a code the supplier does not know is skipped, not used', () => {
    expect(inferNationality({ ...none, saved: 'ZZ', ipCountry: 'XX', destinationCountry: 'IT' })).toEqual({ code: 'IT', source: 'destination' });
  });

  it('reads the region of the most preferred browser language', () => {
    expect(regionFromAcceptLanguage('en-GB,en;q=0.9')).toBe('GB');
    expect(regionFromAcceptLanguage('es;q=0.9,pt-BR;q=0.8')).toBe('BR');
    expect(regionFromAcceptLanguage('fr-CA;q=0.2,de-AT;q=0.7')).toBe('AT');
    expect(regionFromAcceptLanguage('zh-Hant-TW')).toBe('TW');
    expect(regionFromAcceptLanguage('en')).toBeNull();
    expect(regionFromAcceptLanguage('en-001')).toBeNull();
    expect(regionFromAcceptLanguage('xx-ZZ')).toBeNull();
    expect(regionFromAcceptLanguage('de-DE;q=0')).toBeNull();
    expect(regionFromAcceptLanguage(null)).toBeNull();
  });
});

describe('guard: the nationality can never be chosen by price', () => {
  it('the inference takes nothing that carries a price', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'nationality.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./countries']);
    // The signals are exactly these four strings: no room for a price, an offer or a rate.
    expectTypeOf<Parameters<typeof inferNationality>[0]>().toEqualTypeOf<{
      saved: string | null;
      acceptLanguage: string | null;
      ipCountry: string | null;
      destinationCountry: string | null;
    }>();
  });
});

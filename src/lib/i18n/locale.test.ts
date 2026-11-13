import { describe, expect, it } from 'vitest';

import { copy, formatCount, joinList } from './index';
import { fromAcceptLanguage, resolveLocale } from './locale';

describe('choosing the language', () => {
  it('reads the best language we speak from Accept-Language, by weight then order', () => {
    expect(fromAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(fromAcceptLanguage('en-GB,en;q=0.9,es;q=0.8')).toBe('en');
    expect(fromAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.5,en;q=0.4')).toBe('es');
    expect(fromAcceptLanguage('en;q=0.2,es-MX;q=0.7')).toBe('es');
    expect(fromAcceptLanguage('fr,de')).toBeNull();
    expect(fromAcceptLanguage('es;q=0')).toBeNull();
    expect(fromAcceptLanguage('')).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  it('the picker wins over the browser, and English is the floor', () => {
    expect(resolveLocale({ cookie: 'es', acceptLanguage: 'en-GB' })).toBe('es');
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'es-ES' })).toBe('en');
    expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'es-ES' })).toBe('es');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'de-DE' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
  });

  it('an unknown locale falls back to English words', () => {
    expect(copy('xx').ui.send).toBe('Send');
    expect(copy(undefined).ui.send).toBe('Send');
    expect(copy('es').ui.send).toBe('Enviar');
  });

  it('lists and counts in each language', () => {
    expect(joinList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList(['A', 'B', 'C'], 'es')).toBe('A, B y C');
    expect(joinList(['A', 'B'], 'es', 'or')).toBe('A o B');
    expect(formatCount(6206, 'en')).toBe('6,206');
    expect(formatCount(16206, 'es')).toBe('16.206');
  });
});

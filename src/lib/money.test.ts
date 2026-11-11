import { describe, expect, it } from 'vitest';
import { minorUnitDigits, sumMoney, toMoney } from './money';

describe('money', () => {
  it('knows the minor units of 2, 0 and 3 decimal currencies', () => {
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('jpy')).toBe(0);
    expect(minorUnitDigits('KWD')).toBe(3);
  });

  it('converts supplier decimals exactly', () => {
    expect(toMoney(256.18, 'EUR')).toEqual({ amountMinor: 25618, currency: 'EUR' });
    expect(toMoney(281.29, 'EUR').amountMinor).toBe(28129);
    expect(toMoney(12, 'EUR').amountMinor).toBe(1200);
    expect(toMoney(0.1 + 0.2, 'EUR').amountMinor).toBe(30);
    expect(toMoney(19800, 'JPY').amountMinor).toBe(19800);
    expect(toMoney(45.125, 'KWD').amountMinor).toBe(45125);
  });

  it('rounds half away from zero where float multiplication would not', () => {
    expect(Math.round(1.005 * 100)).toBe(100); // the bug this function exists to avoid
    expect(toMoney(1.005, 'EUR').amountMinor).toBe(101);
    expect(toMoney(256.185, 'EUR').amountMinor).toBe(25619);
    expect(toMoney(-1.005, 'EUR').amountMinor).toBe(-101);
    expect(toMoney(0.004, 'EUR').amountMinor).toBe(0);
  });

  it('refuses nonsense', () => {
    expect(() => toMoney(Number.NaN, 'EUR')).toThrow(RangeError);
    expect(() => toMoney(Infinity, 'EUR')).toThrow(RangeError);
    expect(() => toMoney(1, 'EURO')).toThrow(RangeError);
    expect(() => toMoney(1, 'ZZ1')).toThrow(RangeError);
  });

  it('adds one currency and refuses to mix two', () => {
    expect(sumMoney('EUR', [toMoney(1.1, 'EUR'), toMoney(2.2, 'EUR')])).toEqual({ amountMinor: 330, currency: 'EUR' });
    expect(sumMoney('EUR', [])).toEqual({ amountMinor: 0, currency: 'EUR' });
    expect(() => sumMoney('EUR', [toMoney(1, 'USD')])).toThrow(RangeError);
  });
});

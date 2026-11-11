/** An amount in a currency's minor units (cents for EUR, whole yen for JPY). */
export type Money = { amountMinor: number; currency: string };

const digitsCache = new Map<string, number>();

/** Minor-unit digits for an ISO 4217 code: 2 for EUR, 0 for JPY, 3 for KWD. Throws on an unknown code. */
export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  let digits = digitsCache.get(code);
  if (digits === undefined) {
    if (!/^[A-Z]{3}$/.test(code)) throw new RangeError(`not a currency code: ${currency}`);
    digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    digitsCache.set(code, digits);
  }
  return digits;
}

/**
 * A supplier's decimal amount as integer minor units. Rounds half away from
 * zero on the decimal string, so 256.185 is 25619 and not the 25618 that
 * binary floating point gives for 256.185 * 100.
 */
export function toMoney(amount: number, currency: string): Money {
  if (!Number.isFinite(amount)) throw new RangeError(`not a finite amount: ${amount}`);
  const code = currency.toUpperCase();
  const digits = minorUnitDigits(code);
  const sign = amount < 0 ? -1 : 1;
  // toFixed on one extra digit, then round that digit by hand.
  const [whole, frac = ''] = Math.abs(amount).toFixed(digits + 3).split('.');
  const kept = Number(whole + frac.slice(0, digits));
  const next = Number(frac[digits] ?? '0');
  return { amountMinor: sign * (kept + (next >= 5 ? 1 : 0)), currency: code };
}

/** Sum of amounts in one currency. Throws if the currencies differ. */
export function sumMoney(currency: string, parts: Money[]): Money {
  const code = currency.toUpperCase();
  let total = 0;
  for (const p of parts) {
    if (p.currency !== code) throw new RangeError(`cannot add ${p.currency} to ${code}`);
    total += p.amountMinor;
  }
  return { amountMinor: total, currency: code };
}

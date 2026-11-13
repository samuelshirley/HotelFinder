/**
 * Money as the pages print it: a currency sign or code, digits with
 * thousands separators, and two decimals unless the amount is whole
 * ("€158.55", "€1,204", "US$12.40"). Parsed to minor units for arithmetic.
 */
export const MONEY = /^(?:[€£$¥]|[A-Z]{2,3}\$?|CHF\s?)\d{1,3}(?:,\d{3})*(?:\.\d{2})?$/;
export const MONEY_IN_TEXT = /(?:[€£$¥]|[A-Z]{2,3}\$?)\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;

export function minor(text: string): number {
  const t = text.trim();
  if (!MONEY.test(t)) throw new Error(`not an amount of money: "${t}"`);
  const [whole, cents = '00'] = t.replace(/^[^\d]+/, '').replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
}
export const currencySign = (text: string) => text.trim().replace(/[\d,.\s]+$/, '');

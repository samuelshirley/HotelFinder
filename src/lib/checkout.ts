/**
 * Pure pieces of the checkout shared by the server and the page: what is paid
 * at the hotel, and the guest's special request. docs/supplier.md, "Checkout
 * extras", has what the sandbox showed for each.
 */

/** One charge the offer marks not included: paid at the hotel, in its own currency, named as the supplier names it. */
export type HotelCharge = { description: string; amountMinor: number; currency: string };

/** The not-included charges of an offer's fee list, as listed. Included fees are in the total and are left out. */
export function payAtHotelCharges(fees: ReadonlyArray<{ description: string; amountMinor: number; currency: string; included: boolean }>): HotelCharge[] {
  return fees.filter((f) => !f.included).map(({ description, amountMinor, currency }) => ({ description, amountMinor, currency }));
}

/** The longest special request sent to the hotel, in characters. */
export const SPECIAL_REQUEST_MAX = 500;

/** Control characters (not the line break) and invisible or direction-changing characters. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * A special request as it is stored and sent: trimmed, control characters
 * removed (line breaks kept, at most one blank line in a row), null when
 * nothing is left. The text is the guest's words for the hotel: nothing here
 * reads, matches or acts on it. Longer than the limit is refused, not cut:
 * the route's schema enforces it and this is the second check.
 */
export function cleanSpecialRequest(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length === 0) return { ok: true, value: null };
  if ([...text].length > SPECIAL_REQUEST_MAX) return { ok: false };
  return { ok: true, value: text };
}

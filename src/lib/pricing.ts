/**
 * Prices, by who is looking (docs/architecture.md decision 6).
 *
 * Every search is made at ONE margin, the member margin: a setting, not a
 * constant of the business (architecture decision 5). What a signed-out
 * visitor sees is the hotel's own public price for the same room: LiteAPI
 * reports `suggestedSellingPrice` as the larger of the hotel's floor and our
 * price (sandbox, 2026-11-13: docs/supplier.md "Public and member prices"),
 * and selling at or above it publicly is allowed. Signed in (a closed user
 * group) the visitor sees the rate itself, lower at many hotels.
 *
 * So an anonymous session's offer rows are written with the public price
 * (`publicQuote`) and a flag saying a member pays less. The member rate is
 * never written to them: not the amount, not a number derived from it.
 */
export const DEFAULT_MEMBER_MARGIN_PCT = 3;

/** The margin every search is made at. The same for every hotel and every visitor. */
export function searchMarginPct(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MEMBER_MARGIN_PCT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MEMBER_MARGIN_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 50) throw new RangeError('MEMBER_MARGIN_PCT must be a number from 0 to 50');
  return n;
}

/** How long a fetched rate may be ranked and shown before it is fetched again. It is always re-checked before payment. */
export const OFFER_TTL_MS = 15 * 60 * 1000;

/**
 * True when an offer may not be shown to this audience: an anonymous visitor
 * is never quoted under the hotel's suggested public price. Public rows are
 * written at that price (`publicQuote`), so this holds by construction; the
 * finder, the detail view and the checkout still check it, as a second line.
 */
export function isMemberOnlyPrice(
  offer: { totalMinor: number; suggestedSellingMinor: number | null },
  audience: 'public' | 'member',
): boolean {
  return audience === 'public' && offer.suggestedSellingMinor !== null && offer.totalMinor < offer.suggestedSellingMinor;
}

type Money = { amountMinor: number; currency: string };
type Fee = { description: string; amount: Money; included: boolean };
type Cancellation = { penalties?: unknown[] } & Record<string, unknown>;

export type PublicQuote<C> = {
  totalMinor: number;
  /** True when a signed-in member pays less for this room than the price shown. Never how much. */
  lowerForMembers: boolean;
  fees: Fee[];
  cancellation: C;
};

/**
 * What a signed-out visitor is quoted for one supplier offer: the hotel's
 * public price when the rate is under it, else the rate.
 *
 * A raised price also drops every number that is a share of the rate, so the
 * rate cannot be worked out from them: the amounts of the taxes included in
 * it, and the cancellation charges (often the whole stay). What the hotel
 * collects itself (not included) does not depend on our price and is kept.
 */
export function publicQuote<C extends Cancellation>(offer: {
  total: Money;
  suggestedSelling: Money | null;
  fees: Fee[];
  cancellation: C;
}): PublicQuote<C> {
  const ssp = offer.suggestedSelling?.currency === offer.total.currency ? offer.suggestedSelling.amountMinor : null;
  if (ssp === null || offer.total.amountMinor >= ssp) {
    return { totalMinor: offer.total.amountMinor, lowerForMembers: false, fees: offer.fees, cancellation: offer.cancellation };
  }
  return {
    totalMinor: ssp,
    lowerForMembers: true,
    fees: offer.fees.filter((f) => !f.included),
    cancellation: { ...offer.cancellation, penalties: [] },
  };
}

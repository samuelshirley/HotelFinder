/**
 * What each LiteAPI call costs, in ONE place. Read from LiteAPI's pricing page
 * (docs.liteapi.travel/reference/api-pricing-usage-costs, 2026-11-12):
 *
 * - Place endpoints (place search, location lookup): $0.01 per request.
 * - Everything else is free under the Terms of Service: the booking flow
 *   (rates → prebook → book), booking management, and hotel content
 *   (`/data/hotels`, `/data/hotel`), "subject to a 5000:1 search-to-book
 *   ratio and fair usage" (re-read in full 2026-11-12). docs/usage.md.
 *
 * Sandbox (`sand_`) calls are not billed; the ledger still records the list
 * price, with `meta.sandbox`, so cost-per-search is what production would pay.
 *
 * `Record<SupplierOp, OpPrice>`: an op with no price entry is a type error.
 */
export const SUPPLIER_OPS = ['places', 'place', 'search', 'facts', 'content', 'prebook', 'book', 'booking', 'cancel'] as const;
export type SupplierOp = (typeof SUPPLIER_OPS)[number];

export type OpPrice =
  | { pricing: 'per_call'; microcents: number }
  | { pricing: 'free' }
  /** The provider bills it, or may, and we do not know the price: shown as unknown, never as 0. */
  | { pricing: 'unpriced' };

const CENT = 1_000_000;

export const LITEAPI_PRICES: Record<SupplierOp, OpPrice> = {
  places: { pricing: 'per_call', microcents: 1 * CENT },
  place: { pricing: 'per_call', microcents: 1 * CENT },
  search: { pricing: 'free' },
  prebook: { pricing: 'free' },
  book: { pricing: 'free' },
  booking: { pricing: 'free' },
  cancel: { pricing: 'free' },
  facts: { pricing: 'free' },
  content: { pricing: 'free' },
};

export function supplierCall(op: SupplierOp): { costMicrocents: number; pricing: OpPrice['pricing'] } {
  const p = LITEAPI_PRICES[op];
  return { costMicrocents: p.pricing === 'per_call' ? p.microcents : 0, pricing: p.pricing };
}

/** Resend: sign-in code emails. Billed by plan, not per message: recorded, never priced. */
export const RESEND_PRICING = 'unpriced' as const;

/**
 * Google Places (New) Nearby Search, Enterprise SKU (the field mask asks for
 * rating and review count): $35.00 per 1,000 requests after 1,000 free a
 * month (developers.google.com/maps/billing-and-pricing/pricing, read
 * 2026-11-13). The ledger records the list price, 3.5 cents, for every
 * answered request; the free allowance is not subtracted (docs/sights.md).
 */
export const GOOGLE_NEARBY_MICROCENTS = 3.5 * CENT;

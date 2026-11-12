/**
 * What each LiteAPI call costs, in ONE place. Read from LiteAPI's pricing page
 * (docs.liteapi.travel/reference/api-pricing-usage-costs, 2026-11-12):
 *
 * - Place endpoints (place search, location lookup): $0.01 per request.
 * - The core booking flow (rates → prebook → book) and booking management: free,
 *   "assuming a reasonable look-to-book ratio".
 * - Static hotel content (`/data/hotels`, `/data/hotel`): the page's "Other API
 *   Endpoints" section was not readable when this was written, so these are
 *   `unpriced`: never shown as free, never guessed. docs/usage.md.
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
  facts: { pricing: 'unpriced' },
  content: { pricing: 'unpriced' },
};

export function supplierCall(op: SupplierOp): { costMicrocents: number; pricing: OpPrice['pricing'] } {
  const p = LITEAPI_PRICES[op];
  return { costMicrocents: p.pricing === 'per_call' ? p.microcents : 0, pricing: p.pricing };
}

/** Resend: sign-in code emails. Billed by plan, not per message: recorded, never priced. */
export const RESEND_PRICING = 'unpriced' as const;

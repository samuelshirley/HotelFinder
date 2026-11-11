/**
 * What is added to the supplier's net rate, by audience. Not a constant of
 * the business: both numbers are settings, to be chosen after the cost
 * measurement (architecture decision 5).
 *
 * `public` is what an anonymous visitor is quoted. The finder additionally
 * drops any public offer priced under the hotel's suggested selling price.
 */
export const DEFAULT_MARGIN_PCT = { public: 15, member: 3 } as const;

export function marginFor(audience: 'public' | 'member', env: Record<string, string | undefined> = process.env): number {
  const raw = audience === 'public' ? env.PUBLIC_MARGIN_PCT : env.MEMBER_MARGIN_PCT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MARGIN_PCT[audience];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 50) {
    throw new RangeError(`${audience === 'public' ? 'PUBLIC' : 'MEMBER'}_MARGIN_PCT must be a number from 0 to 50`);
  }
  return n;
}

/** How long a fetched rate may be ranked and shown before it is fetched again. It is always re-checked before payment. */
export const OFFER_TTL_MS = 15 * 60 * 1000;

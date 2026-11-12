/** 1 cent = 1,000,000 microcents, so $1 = 100,000,000. */
const PER_DOLLAR = 100_000_000;

/**
 * A ledger amount in dollars, precise enough to tell small costs apart: a
 * search's AI cost is often a fraction of a cent, so cents alone would read 0.
 */
export function formatMicrocents(microcents: number): string {
  if (microcents === 0) return '$0';
  const dollars = microcents / PER_DOLLAR;
  const digits = Math.abs(dollars) >= 1 ? 2 : Math.abs(dollars) >= 0.01 ? 4 : 6;
  return `${dollars < 0 ? '-' : ''}$${Math.abs(dollars).toFixed(digits)}`;
}

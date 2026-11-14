import { z } from 'zod';

/**
 * A calendar date as `YYYY-MM-DD` that exists: 2026-12-40 and 2027-02-29 are
 * not dates. Every date a route or a producer hands us is checked by this one
 * schema, so an impossible date is `invalid_request` at the boundary and never
 * reaches the store, the supplier or a reply (Sam, 2026-11-14). In chat it is
 * read as a typo and the dates are asked for again (lib/router/slots.ts).
 */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// The pattern stays on the schema so a tool's JSON schema still shows the model the shape.
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'not a calendar date');

import { copy } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';
import { formatMoney } from '@/lib/replies';

/**
 * Penny's pick: when a search finds a lot, she names one of the shortlisted
 * hotels and asks which appeals. Deterministic, no model.
 *
 * Her own pick: among the top three, the best rated one that costs at most
 * 15% more than the cheapest of the three (ties go to the higher-ranked).
 *
 * A paid pick (the hotel is in SPONSORED_HOTELS) may replace hers ONLY when
 * it is the same apple: on the shortlist, within 5% of her pick's price,
 * rated no more than 0.2 lower, and no more than 0.5 km further when both
 * distances are known. A paid pick is ALWAYS returned with `sponsored: true`
 * and the chat labels it; EU law forbids an unlabelled paid recommendation.
 * The ranked list is never touched.
 */
export const PICK_MIN_FITS = 8;
export const SAME_PRICE = 0.05;
export const SAME_RATING = 0.2;
export const SAME_DISTANCE_KM = 0.5;

export type PickRow = { propertyId: string; supplierHotelId: string; name: string; totalMinor: number; currency: string; rating: number | null; km: number | null };
export type PennyPick = { propertyId: string; name: string; sponsored: boolean; why: string };

function ownPick(rows: PickRow[]): PickRow {
  const top = rows.slice(0, 3);
  const cheapest = Math.min(...top.map((r) => r.totalMinor));
  const affordable = top.filter((r) => r.totalMinor <= cheapest * 1.15);
  return affordable.reduce((best, r) => ((r.rating ?? 0) > (best.rating ?? 0) ? r : best), affordable[0]);
}

export function sameApple(paid: PickRow, own: PickRow): boolean {
  if (paid.currency !== own.currency) return false;
  if (Math.abs(paid.totalMinor - own.totalMinor) > own.totalMinor * SAME_PRICE) return false;
  if ((paid.rating ?? 0) < (own.rating ?? 0) - SAME_RATING) return false;
  if (paid.km !== null && own.km !== null && paid.km > own.km + SAME_DISTANCE_KM) return false;
  return true;
}

function why(r: PickRow, rows: PickRow[], locale: Locale): string {
  const p = copy(locale).penny;
  const cheapest = Math.min(...rows.slice(0, 3).map((x) => x.totalMinor));
  const price = r.totalMinor === cheapest ? p.cheapestOfTopThree : p.moreThanCheapest(formatMoney(r.totalMinor - cheapest, r.currency, locale));
  return r.rating !== null ? p.ratedThen(r.rating, price) : price;
}

export function pennyPick(rows: PickRow[], eligible: number, sponsored: ReadonlySet<string>, locale: Locale = 'en'): PennyPick | null {
  if (eligible < PICK_MIN_FITS || rows.length < 2) return null;
  const own = ownPick(rows);
  const paid = rows.find((r) => r !== own && sponsored.has(r.supplierHotelId) && sameApple(r, own));
  const chosen = paid ?? own;
  return { propertyId: chosen.propertyId, name: chosen.name, sponsored: Boolean(paid) || sponsored.has(chosen.supplierHotelId), why: why(chosen, rows, locale) };
}

/** Penny's line. A paid pick says so in the words too, not only in the tag. */
export function pennyLine(eligible: number, pick: PennyPick, locale: Locale = 'en'): string {
  const p = copy(locale).penny;
  return (pick.sponsored ? p.nudgeSponsored : p.nudge)(eligible, pick.name, pick.why);
}

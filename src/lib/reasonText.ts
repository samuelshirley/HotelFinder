import { formatMoney } from '@/lib/replies';

/**
 * The words for a machine-readable ranking reason. The finder decides why a
 * hotel is where it is; this only says it. No model is involved, and nothing
 * here can state a reason the finder did not give.
 */
export type ReasonLike = { kind: string } & Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function reasonText(reason: ReasonLike | null, ctx: { currency: string; hasMustHaves: boolean }): string {
  if (!reason) return '';
  switch (reason.kind) {
    case 'cheapest_meeting_all_musts':
      return ctx.hasMustHaves ? 'Cheapest that has everything you asked for' : 'Cheapest available';
    case 'closest': {
      const km = num(reason.km);
      const where = reason.to === 'place' ? 'the place you named' : 'the middle of the results';
      return km === null ? 'Closest' : `Closest: ${formatKm(km)} from ${where}`;
    }
    case 'best_rated': {
      const reviews = num(reason.reviews);
      return `Best rated: ${reason.rating}${reviews === null ? '' : ` from ${reviews.toLocaleString('en')} reviews`}`;
    }
    case 'cheapest_well_reviewed':
      return `Cheapest rated ${reason.rating} or better by ${num(reason.reviews)?.toLocaleString('en') ?? 'many'} guests`;
    case 'best_balance':
      return 'Best balance of price, rating and distance';
    case 'runner_up': {
      const parts: string[] = [];
      const price = num(reason.price_delta_minor);
      if (price !== null) parts.push(price === 0 ? 'same price' : `${formatMoney(Math.abs(price), ctx.currency)} ${price > 0 ? 'more' : 'less'}`);
      const km = num(reason.km_delta);
      if (km !== null && km !== 0) parts.push(`${formatKm(Math.abs(km))} ${km > 0 ? 'further' : 'closer'}`);
      const rating = num(reason.rating_delta);
      if (rating !== null && rating !== 0) parts.push(`rated ${Math.abs(rating)} ${rating > 0 ? 'higher' : 'lower'}`);
      return parts.length ? `Than the first: ${parts.join(', ')}` : '';
    }
    default:
      return '';
  }
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

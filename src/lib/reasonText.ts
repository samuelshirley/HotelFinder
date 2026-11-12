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
      return km === null ? 'Closest' : `Closest: ${formatKm(km)} from ${fromWhere(reason)}`;
    }
    case 'best_mix': {
      const of = (Array.isArray(reason.of) ? reason.of : []).filter((k): k is string => typeof k === 'string');
      const words: Record<string, string> = { cheapest: 'low price', nicest: 'great reviews', closest: 'location' };
      const named = of.map((k) => words[k]).filter(Boolean);
      const facts: string[] = [];
      const rating = num(reason.rating);
      if (of.includes('nicest') && rating !== null) facts.push(`rated ${rating}`);
      const rank = num(reason.price_rank);
      const eligible = num(reason.eligible);
      if (of.includes('cheapest') && rank !== null && eligible !== null) facts.push(`${ordinal(rank)} cheapest of ${eligible}`);
      const km = num(reason.km);
      if (of.includes('closest') && km !== null) facts.push(`${formatKm(km)} from ${fromWhere(reason)}`);
      const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : (named[0] ?? 'what you asked for');
      return `Best mix of ${list}${facts.length ? `: ${facts.join(', ')}` : ''}`;
    }
    case 'best_rated': {
      const reviews = num(reason.reviews);
      return `Best rated: ${reason.rating}${reviews === null ? '' : ` from ${reviews.toLocaleString('en')} reviews`}`;
    }
    // Retired with "just a decent bed"; rows ranked before the change can still carry it.
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

function fromWhere(reason: ReasonLike): string {
  const label = typeof reason.to_label === 'string' && reason.to_label ? reason.to_label : null;
  if (reason.to === 'place') return label ?? 'the place you named';
  if (reason.to === 'destination') return label ?? 'the place you searched';
  return 'the middle of the results';
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

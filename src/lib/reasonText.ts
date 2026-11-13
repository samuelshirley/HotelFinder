import { isMustHave } from '@/lib/amenities';
import { aKind, eitherOf, isListedPropertyType, isPropertyType } from '@/lib/filters';
import { formatMoney, MUST_HAVE_LABEL } from '@/lib/replies';

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
    case 'near_miss':
      return missText(reason.misses, ctx.currency);
    default:
      return '';
  }
}

/** What a near-miss misses, from the finder's own list (finder/rank.ts `Miss`). */
export function missText(misses: unknown, currency: string): string {
  const parts = (Array.isArray(misses) ? misses : []).flatMap((m): string[] => {
    const miss = m as { kind?: unknown; over_by_minor?: unknown; must?: unknown; unknown?: unknown; min?: unknown; stars?: unknown; rating?: unknown; wanted?: unknown; listed?: unknown };
    switch (miss.kind) {
      case 'over_price_cap': {
        const over = num(miss.over_by_minor);
        return [over === null ? 'over your price cap' : `${formatMoney(over, currency)} a night over your cap`];
      }
      case 'missing_must_have': {
        const words = (v: unknown) => (Array.isArray(v) ? v : []).filter(isMustHave).map((k) => MUST_HAVE_LABEL[k]);
        const either = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0]);
        const lacking = words(miss.must);
        const unknown = words(miss.unknown);
        return [
          ...(lacking.length ? [`no ${either(lacking)}`] : []),
          ...(unknown.length ? [`the listing does not say if it has ${either(unknown)}`] : []),
        ];
      }
      case 'member_price':
        return ['its rate is a member price, not shown before you sign in'];
      // The filters (lib/filters.ts). A silent listing is said as exactly that, never as a "no".
      case 'below_stars': {
        const stars = num(miss.stars);
        return [stars === null ? 'the listing does not give a star class' : `${stars} star${stars === 1 ? '' : 's'}`];
      }
      case 'below_rating': {
        const rating = num(miss.rating);
        return [rating === null ? 'the listing does not give a guest rating' : `rated ${rating}`];
      }
      case 'not_property_type': {
        const listed = isListedPropertyType(miss.listed) ? miss.listed : null;
        const wanted = (Array.isArray(miss.wanted) ? miss.wanted : []).filter(isPropertyType).map(aKind);
        if (listed === null) return ['the listing does not say what kind of place it is'];
        return [listed === 'other' ? `not ${eitherOf(wanted)}` : `it is ${aKind(listed)}`];
      }
      case 'not_chain': {
        const listed = typeof miss.listed === 'string' && miss.listed ? miss.listed : null;
        return [listed === null ? 'the listing names no brand' : `it is ${listed}`];
      }
      default:
        return [];
    }
  });
  return parts.length ? `Misses: ${parts.join('; ')}` : '';
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

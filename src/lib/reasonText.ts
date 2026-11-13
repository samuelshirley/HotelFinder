import { isMustHave } from '@/lib/amenities';
import { aKind, eitherOf, isListedPropertyType, isPropertyType } from '@/lib/filters';
import { copy, formatCount, joinList } from '@/lib/i18n';
import { INTL, type Locale } from '@/lib/i18n/locale';
import { formatMoney, mustHaveLabel } from '@/lib/replies';

/**
 * The words for a machine-readable ranking reason. The finder decides why a
 * hotel is where it is; this only says it. No model is involved, and nothing
 * here can state a reason the finder did not give. The words are the
 * locale's (lib/i18n/catalogue); English when no locale is given.
 */
export type ReasonLike = { kind: string } & Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function reasonText(reason: ReasonLike | null, ctx: { currency: string; hasMustHaves: boolean; locale?: Locale }): string {
  if (!reason) return '';
  const locale = ctx.locale ?? 'en';
  const t = copy(locale).reasons;
  switch (reason.kind) {
    case 'cheapest_meeting_all_musts':
      return ctx.hasMustHaves ? t.cheapestMeetingAll : t.cheapestAvailable;
    case 'closest': {
      const km = num(reason.km);
      return km === null ? t.closest : t.closestFrom(formatKm(km, locale), fromWhere(reason, locale));
    }
    case 'best_mix': {
      const of = (Array.isArray(reason.of) ? reason.of : []).filter((k): k is string => typeof k === 'string');
      const named = of.map((k) => t.mixWord[k]).filter(Boolean);
      const facts: string[] = [];
      const rating = num(reason.rating);
      if (of.includes('nicest') && rating !== null) facts.push(t.rated(rating));
      const rank = num(reason.price_rank);
      const eligible = num(reason.eligible);
      if (of.includes('cheapest') && rank !== null && eligible !== null) facts.push(t.nthCheapest(copy(locale).words.ordinal(rank), eligible));
      const km = num(reason.km);
      if (of.includes('closest') && km !== null) facts.push(t.kmFrom(formatKm(km, locale), fromWhere(reason, locale)));
      const list = named.length > 0 ? joinList(named, locale) : t.whatYouAskedFor;
      return t.bestMix(list, facts.join(', '));
    }
    case 'best_rated': {
      const reviews = num(reason.reviews);
      return t.bestRated(reason.rating, reviews === null ? null : formatCount(reviews, locale));
    }
    // Retired with "just a decent bed"; rows ranked before the change can still carry it.
    case 'cheapest_well_reviewed': {
      const reviews = num(reason.reviews);
      return t.cheapestWellReviewed(reason.rating, reviews === null ? null : formatCount(reviews, locale));
    }
    case 'best_balance':
      return t.bestBalance;
    case 'runner_up': {
      const parts: string[] = [];
      const price = num(reason.price_delta_minor);
      if (price !== null) parts.push(price === 0 ? t.samePrice : (price > 0 ? t.more : t.less)(formatMoney(Math.abs(price), ctx.currency, locale)));
      const km = num(reason.km_delta);
      if (km !== null && km !== 0) parts.push((km > 0 ? t.further : t.closer)(formatKm(Math.abs(km), locale)));
      const rating = num(reason.rating_delta);
      if (rating !== null && rating !== 0) parts.push((rating > 0 ? t.ratedHigher : t.ratedLower)(Math.abs(rating)));
      return parts.length ? t.thanFirst(parts.join(', ')) : '';
    }
    case 'near_miss':
      return missText(reason.misses, ctx.currency, locale);
    default:
      return '';
  }
}

/** What a near-miss misses, from the finder's own list (finder/rank.ts `Miss`). */
export function missText(misses: unknown, currency: string, locale: Locale = 'en'): string {
  const t = copy(locale).reasons;
  const parts = (Array.isArray(misses) ? misses : []).flatMap((m): string[] => {
    const miss = m as { kind?: unknown; over_by_minor?: unknown; must?: unknown; unknown?: unknown; min?: unknown; stars?: unknown; rating?: unknown; wanted?: unknown; listed?: unknown };
    switch (miss.kind) {
      case 'over_price_cap': {
        const over = num(miss.over_by_minor);
        return [over === null ? t.overCap : t.overCapBy(formatMoney(over, currency, locale))];
      }
      case 'missing_must_have': {
        const words = (v: unknown) => (Array.isArray(v) ? v : []).filter(isMustHave).map((k) => mustHaveLabel(k, locale));
        const lacking = words(miss.must);
        const unknown = words(miss.unknown);
        return [...(lacking.length ? [t.lacks(joinList(lacking, locale, 'or'))] : []), ...(unknown.length ? [t.notSaid(joinList(unknown, locale, 'or'))] : [])];
      }
      case 'member_price':
        return [t.memberPrice];
      // The filters (lib/filters.ts). A silent listing is said as exactly that, never as a "no".
      case 'below_stars': {
        const stars = num(miss.stars);
        return [stars === null ? t.noStarClass : t.starClass(stars)];
      }
      case 'below_rating': {
        const rating = num(miss.rating);
        return [rating === null ? t.noRating : t.ratedOnly(rating)];
      }
      case 'not_property_type': {
        const listed = isListedPropertyType(miss.listed) ? miss.listed : null;
        const wanted = (Array.isArray(miss.wanted) ? miss.wanted : []).filter(isPropertyType).map((k) => aKind(k, locale));
        if (listed === null) return [t.noKind];
        return [listed === 'other' ? t.notKinds(eitherOf(wanted, locale)) : t.itIs(aKind(listed, locale))];
      }
      case 'not_chain': {
        const listed = typeof miss.listed === 'string' && miss.listed ? miss.listed : null;
        return [listed === null ? t.noBrand : t.itIs(listed)];
      }
      default:
        return [];
    }
  });
  return parts.length ? t.misses(parts.join('; ')) : '';
}

function fromWhere(reason: ReasonLike, locale: Locale): string {
  const t = copy(locale).reasons;
  const label = typeof reason.to_label === 'string' && reason.to_label ? reason.to_label : null;
  if (reason.to === 'place') return label ?? t.placeNamed;
  if (reason.to === 'destination') return label ?? t.placeSearched;
  return t.middle;
}

export function formatKm(km: number, locale: Locale = 'en'): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString(INTL[locale].number, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

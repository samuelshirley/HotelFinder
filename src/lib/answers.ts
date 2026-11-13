import type { Amenity, MustHave } from '@/lib/amenities';
import { includesBreakfast, type DistanceFrom, type PriorityKey } from '@/lib/finder/rank';
import type { SearchField, Superlative } from '@/lib/router/catalogue';
import type { AnswerPlan, FactAsk } from '@/lib/router/route';

/**
 * Answers to questions about what is already on screen, read off rows the
 * server holds. No model is involved: a plan names what to read, this reads
 * it, and `answerLine` (lib/replies.ts) says it.
 *
 * The rule that does not move: a value the row does not hold is `not_held`,
 * which is said as "the listing does not say". Nothing is inferred. In
 * particular a hotel with no facility list is unknown, not "no".
 */

/** One hotel on screen, as the offer and property rows describe it. null = the row is silent. */
export type HotelFacts = {
  /** false = shown under the divider because it misses a constraint (finder/rank.ts). Absent = fits. */
  fits?: boolean;
  propertyId: string;
  name: string;
  stars: number | null;
  rating: number | null;
  reviewCount: number | null;
  /** Whole stay, taxes and fees included. null when no rate is held. */
  totalMinor: number | null;
  payAtPropertyMinor: number | null;
  roomName: string | null;
  boardName: string | null;
  refundable: boolean | null;
  /** ISO instant. */
  freeCancellationUntil: string | null;
  distanceKm: number | null;
  /** null = the supplier sent no facility list for this hotel. An empty list = it lists none. */
  amenities: readonly Amenity[] | null;
};

export type AnswerContext = {
  nights: number;
  /** What `distanceKm` is measured from, and its name when it has one (the place named, the airport). */
  distanceFrom: DistanceFrom;
  distanceLabel: string | null;
  search: {
    destinationText: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenAges: number[];
    rooms: number;
    priceCapMinor: number | null;
    mustHaves: MustHave[];
    /** null = not asked; [] = no preference. */
    priorities: PriorityKey[] | null;
    /** Where "close" is measured from, in words. */
    nearLabel: string;
  };
};

export type RankValue =
  | { on: 'price'; totalMinor: number; nights: number }
  | { on: 'distance'; km: number; from: DistanceFrom; label: string | null }
  | { on: 'rating'; rating: number; reviews: number | null }
  | { on: 'reviews'; reviews: number }
  | { on: 'stars'; stars: number };

export type Answer =
  | { kind: 'price'; name: string; totalMinor: number; nights: number; perNightMinor: number; payAtPropertyMinor: number }
  | { kind: 'cancellation'; name: string; refundable: boolean; until: string | null }
  | { kind: 'breakfast'; name: string; included: boolean; boardName: string }
  | { kind: 'rating'; name: string; rating: number; reviews: number | null }
  | { kind: 'stars'; name: string; stars: number }
  | { kind: 'room'; name: string; roomName: string }
  | { kind: 'distance'; name: string; km: number; from: DistanceFrom; label: string | null }
  | { kind: 'facility'; name: string; amenity: Amenity; listed: boolean }
  | { kind: 'not_held'; name: string; ask: FactAsk }
  | { kind: 'across'; ask: FactAsk; yes: string[]; no: string[]; unknown: string[] }
  | { kind: 'ranking'; superlative: Superlative; winners: string[]; value: RankValue; of: number; missing: number }
  | { kind: 'ranking_not_held'; superlative: Superlative; of: number }
  | { kind: 'search'; field: SearchField; search: AnswerContext['search'] };

/** A cancellation deadline only if it is a real instant. */
function deadline(iso: string | null): string | null {
  return iso !== null && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

/** One fact about one hotel, or `not_held` when its row does not say. */
export function hotelAnswer(h: HotelFacts, ask: FactAsk, ctx: Pick<AnswerContext, 'nights' | 'distanceFrom' | 'distanceLabel'>): Answer {
  const notHeld: Answer = { kind: 'not_held', name: h.name, ask };
  switch (ask.fact) {
    case 'price':
      if (h.totalMinor === null) return notHeld;
      return {
        kind: 'price',
        name: h.name,
        totalMinor: h.totalMinor,
        nights: ctx.nights,
        // Rounded up, as the card and the price cap do.
        perNightMinor: Math.ceil(h.totalMinor / Math.max(1, ctx.nights)),
        payAtPropertyMinor: h.payAtPropertyMinor ?? 0,
      };
    case 'cancellation':
      return h.refundable === null ? notHeld : { kind: 'cancellation', name: h.name, refundable: h.refundable, until: h.refundable ? deadline(h.freeCancellationUntil) : null };
    case 'breakfast':
      return h.boardName === null ? notHeld : { kind: 'breakfast', name: h.name, included: includesBreakfast(h.boardName), boardName: h.boardName };
    case 'rating':
      return h.rating === null ? notHeld : { kind: 'rating', name: h.name, rating: h.rating, reviews: h.reviewCount };
    case 'stars':
      return h.stars === null ? notHeld : { kind: 'stars', name: h.name, stars: h.stars };
    case 'room':
      return h.roomName === null ? notHeld : { kind: 'room', name: h.name, roomName: h.roomName };
    case 'distance':
      return h.distanceKm === null ? notHeld : { kind: 'distance', name: h.name, km: h.distanceKm, from: ctx.distanceFrom, label: ctx.distanceLabel };
    case 'facility':
      return h.amenities === null ? notHeld : { kind: 'facility', name: h.name, amenity: ask.amenity, listed: h.amenities.includes(ask.amenity) };
  }
}

/** yes / no / the row does not say, for the facts that can be asked of every hotel. */
function holds(h: HotelFacts, ask: FactAsk): boolean | null {
  switch (ask.fact) {
    case 'facility':
      return h.amenities === null ? null : h.amenities.includes(ask.amenity);
    case 'breakfast':
      return h.boardName === null ? null : includesBreakfast(h.boardName);
    case 'cancellation':
      return h.refundable;
    default:
      return null;
  }
}

const METRIC: Record<Superlative, { value: (h: HotelFacts) => number | null; highest: boolean }> = {
  cheapest: { value: (h) => h.totalMinor, highest: false },
  priciest: { value: (h) => h.totalMinor, highest: true },
  closest: { value: (h) => h.distanceKm, highest: false },
  furthest: { value: (h) => h.distanceKm, highest: true },
  best_rated: { value: (h) => h.rating, highest: true },
  most_reviews: { value: (h) => h.reviewCount, highest: true },
  most_stars: { value: (h) => h.stars, highest: true },
};

/** The hotels at the extreme of a metric (more than one on a tie), and how many rows hold no value for it. */
export function rankHotels(hotels: readonly HotelFacts[], superlative: Superlative): { winners: HotelFacts[]; best: number | null; missing: number } {
  const { value, highest } = METRIC[superlative];
  const held = hotels.flatMap((h) => {
    const v = value(h);
    return v === null ? [] : [{ h, v }];
  });
  if (held.length === 0) return { winners: [], best: null, missing: hotels.length };
  const best = held.reduce((acc, x) => (highest ? Math.max(acc, x.v) : Math.min(acc, x.v)), held[0].v);
  return { winners: held.filter((x) => x.v === best).map((x) => x.h), best, missing: hotels.length - held.length };
}

function rankValue(superlative: Superlative, winner: HotelFacts, best: number, ctx: AnswerContext): RankValue {
  switch (superlative) {
    case 'cheapest':
    case 'priciest':
      return { on: 'price', totalMinor: best, nights: ctx.nights };
    case 'closest':
    case 'furthest':
      return { on: 'distance', km: best, from: ctx.distanceFrom, label: ctx.distanceLabel };
    case 'best_rated':
      return { on: 'rating', rating: best, reviews: winner.reviewCount };
    case 'most_reviews':
      return { on: 'reviews', reviews: best };
    case 'most_stars':
      return { on: 'stars', stars: best };
  }
}

/**
 * The answer to a plan, or null when the rows cannot give one honest answer
 * (the hotel is no longer on screen; "the cheapest" is a tie, so there is no
 * single hotel to read the fact from). Null sends the message to the agent.
 */
export function buildAnswer(plan: AnswerPlan, listed: readonly HotelFacts[], ctx: AnswerContext): Answer | null {
  // "The cheapest", "do they all…": over the hotels that fit, not the ones
  // shown under the divider to fill the list. Over everything only when none fit.
  const fitting = listed.filter((h) => h.fits !== false);
  const hotels = fitting.length > 0 ? fitting : listed;
  switch (plan.about) {
    case 'search':
      return { kind: 'search', field: plan.field, search: ctx.search };
    case 'hotel': {
      const h = listed.find((x) => x.propertyId === plan.propertyId);
      return h ? hotelAnswer(h, plan, ctx) : null;
    }
    case 'hotel_by_rank': {
      const { winners } = rankHotels(hotels, plan.superlative);
      return winners.length === 1 ? hotelAnswer(winners[0], plan, ctx) : null;
    }
    case 'all': {
      if (hotels.length === 0) return null;
      const yes: string[] = [];
      const no: string[] = [];
      const unknown: string[] = [];
      for (const h of hotels) {
        const v = holds(h, plan);
        (v === null ? unknown : v ? yes : no).push(h.name);
      }
      return { kind: 'across', ask: plan, yes, no, unknown };
    }
    case 'ranking': {
      if (hotels.length === 0) return null;
      const { winners, best, missing } = rankHotels(hotels, plan.superlative);
      if (best === null) return { kind: 'ranking_not_held', superlative: plan.superlative, of: hotels.length };
      // The review count is only said for a single winner: on a tie it would be one hotel's.
      const value = rankValue(plan.superlative, winners[0], best, ctx);
      return {
        kind: 'ranking',
        superlative: plan.superlative,
        winners: winners.map((w) => w.name),
        value: value.on === 'rating' && winners.length > 1 ? { ...value, reviews: null } : value,
        of: hotels.length,
        missing,
      };
    }
  }
}

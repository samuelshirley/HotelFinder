import { AMENITIES, type Amenity, type MustHave } from '@/lib/amenities';
import { haversineKm, medianPoint, nightsBetween, type LatLng } from './geo';

/**
 * The stay finder's ranking. Pure: candidates in, a ranked shortlist with a
 * machine-readable reason per row out. No I/O, no clock, no model.
 *
 * Two properties are tested for every priority:
 *  - nothing on the shortlist violates a hard constraint;
 *  - DOMINANCE: a hotel that is no worse on price, distance, rating and review
 *    count than another, and better on at least one, never ranks below it.
 */

export const PRIORITY_KEYS = ['cheapest', 'closest', 'nicest', 'basic'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];

export type Candidate = {
  /** Our id for the offer row (or any stable id in tests). */
  offerId: string;
  propertyId: string;
  name: string;
  /** Whole stay, minor units. */
  totalMinor: number;
  /** The hotel's suggested public price, when known. */
  suggestedSellingMinor: number | null;
  location: LatLng | null;
  rating: number | null;
  reviewCount: number | null;
  stars: number | null;
  /** null = the supplier told us nothing about this hotel's amenities. */
  amenities: readonly Amenity[] | null;
  refundable: boolean;
  /** The supplier's board name for the first room, e.g. "Room Only". */
  boardName: string | null;
};

export type RankInput = {
  candidates: Candidate[];
  checkIn: string;
  checkOut: string;
  /** null = the user has not said what "best" means yet. */
  priority: PriorityKey | null;
  mustHaves: readonly MustHave[];
  /** Per night for the whole party, minor units. */
  priceCapMinor: number | null;
  /** The place the user wants to be near, when one was resolved. */
  near: LatLng | null;
  /** Anonymous visitors may not be shown a price under the hotel's public price. */
  audience: 'public' | 'member';
  excludedPropertyIds?: readonly string[];
  size?: number;
};

export type RejectionReason = 'over_price_cap' | 'missing_must_have' | 'below_public_price' | 'excluded_by_user';

export type Reason =
  | { kind: 'cheapest_meeting_all_musts' }
  | { kind: 'closest'; km: number; to: 'place' | 'search_centre' }
  | { kind: 'best_rated'; rating: number; reviews: number | null }
  | { kind: 'cheapest_well_reviewed'; rating: number; reviews: number }
  | { kind: 'best_balance' }
  | { kind: 'runner_up'; price_delta_minor: number; km_delta: number | null; rating_delta: number | null };

export type Ranked = {
  candidate: Candidate;
  rank: number;
  reason: Reason;
  km: number | null;
  perNightMinor: number;
};

export type RankResult = {
  shortlist: Ranked[];
  /** Every eligible candidate in order: the shortlist is its head. */
  ordered: Ranked[];
  eligible: number;
  rejected: Record<RejectionReason, number>;
  /** Which must-haves could not be checked for at least one hotel (amenities unknown). */
  uncheckable: number;
  distanceFrom: 'place' | 'search_centre' | null;
};

/** "Well reviewed" for the `basic` priority: enough people, and they liked it. */
export const WELL_REVIEWED = { rating: 7.5, reviews: 50 };

const BREAKFAST = /breakfast|half board|full board|all inclusive/i;

export function meetsMustHave(c: Candidate, must: MustHave): boolean {
  if (must === 'free_cancellation') return c.refundable;
  if (must === 'breakfast_included') return c.boardName !== null && BREAKFAST.test(c.boardName) && !/room only/i.test(c.boardName);
  // An amenity we have no data for is not claimed: unknown fails the must-have.
  return c.amenities !== null && (AMENITIES as readonly string[]).includes(must) && c.amenities.includes(must);
}

type Scored = { c: Candidate; km: number | null; perNightMinor: number };

/** Higher is better for rating and reviews; unknown sorts last. */
const price = (s: Scored) => s.c.totalMinor;
const dist = (s: Scored) => s.km ?? Number.POSITIVE_INFINITY;
const rating = (s: Scored) => -(s.c.rating ?? Number.NEGATIVE_INFINITY);
const reviews = (s: Scored) => -(s.c.reviewCount ?? Number.NEGATIVE_INFINITY);
const wellReviewed = (s: Scored) =>
  (s.c.rating ?? 0) >= WELL_REVIEWED.rating && (s.c.reviewCount ?? 0) >= WELL_REVIEWED.reviews ? 0 : 1;

type Key = (s: Scored) => number;

/**
 * Each priority is a lexicographic order over keys that are all "lower is
 * better" and all monotone in the four dominance metrics. Every chain ends in
 * all four metrics, so a dominating hotel can never compare worse.
 */
const ORDER: Record<PriorityKey, Key[]> = {
  cheapest: [price, rating, dist, reviews],
  closest: [dist, price, rating, reviews],
  nicest: [rating, reviews, price, dist],
  basic: [wellReviewed, price, rating, dist, reviews],
};

function compareBy(keys: Key[]) {
  return (a: Scored, b: Scored) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x !== y) return x < y ? -1 : 1;
    }
    // A total order: the same input always gives the same output.
    return a.c.offerId < b.c.offerId ? -1 : a.c.offerId > b.c.offerId ? 1 : 0;
  };
}

/** No priority yet: price, rating and distance, each scaled to the candidate set. */
function balancedOrder(scored: Scored[]): (a: Scored, b: Scored) => number {
  const span = (values: number[]) => {
    const finite = values.filter(Number.isFinite);
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    return (v: number) => (!Number.isFinite(v) ? 1 : hi === lo ? 0 : (v - lo) / (hi - lo));
  };
  const p = span(scored.map(price));
  const d = span(scored.map(dist));
  const r = span(scored.map(rating));
  const score = (s: Scored) => 0.5 * p(price(s)) + 0.3 * r(rating(s)) + 0.2 * d(dist(s));
  const fallback = compareBy([price, rating, dist, reviews]);
  return (a, b) => {
    const x = score(a);
    const y = score(b);
    return x !== y ? (x < y ? -1 : 1) : fallback(a, b);
  };
}

function topReason(priority: PriorityKey | null, top: Scored, from: 'place' | 'search_centre' | null): Reason {
  switch (priority) {
    case 'cheapest':
      return { kind: 'cheapest_meeting_all_musts' };
    case 'closest':
      return top.km !== null && from ? { kind: 'closest', km: top.km, to: from } : { kind: 'best_balance' };
    case 'nicest':
      return top.c.rating !== null
        ? { kind: 'best_rated', rating: top.c.rating, reviews: top.c.reviewCount }
        : { kind: 'best_balance' };
    case 'basic':
      return wellReviewed(top) === 0
        ? { kind: 'cheapest_well_reviewed', rating: top.c.rating as number, reviews: top.c.reviewCount as number }
        : { kind: 'cheapest_meeting_all_musts' };
    default:
      return { kind: 'best_balance' };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function rankStay(input: RankInput): RankResult {
  const nights = Math.max(1, nightsBetween(input.checkIn, input.checkOut));
  const excluded = new Set(input.excludedPropertyIds ?? []);
  const rejected: Record<RejectionReason, number> = {
    over_price_cap: 0,
    missing_must_have: 0,
    below_public_price: 0,
    excluded_by_user: 0,
  };
  let uncheckable = 0;

  // Distances are measured from the place the user named, else from the
  // middle of what the search returned. The reason says which.
  const located = input.candidates.flatMap((c) => (c.location ? [c.location] : []));
  const centre = input.near ?? medianPoint(located);
  const distanceFrom = input.near ? 'place' : centre ? 'search_centre' : null;

  const eligible: Scored[] = [];
  for (const c of input.candidates) {
    if (excluded.has(c.propertyId)) {
      rejected.excluded_by_user += 1;
      continue;
    }
    if (input.audience === 'public' && c.suggestedSellingMinor !== null && c.totalMinor < c.suggestedSellingMinor) {
      rejected.below_public_price += 1;
      continue;
    }
    const perNightMinor = Math.ceil(c.totalMinor / nights);
    if (input.priceCapMinor !== null && perNightMinor > input.priceCapMinor) {
      rejected.over_price_cap += 1;
      continue;
    }
    if (!input.mustHaves.every((m) => meetsMustHave(c, m))) {
      rejected.missing_must_have += 1;
      if (c.amenities === null && input.mustHaves.some((m) => (AMENITIES as readonly string[]).includes(m))) uncheckable += 1;
      continue;
    }
    // Rounded to 100 m HERE, before ranking: the order is decided on the same
    // number the user is shown. Ranking on the exact distance put a dearer,
    // worse-rated hotel first for being 20 m closer while both read "0.5 km".
    eligible.push({ c, km: centre && c.location ? round1(haversineKm(centre, c.location)) : null, perNightMinor });
  }

  const order = input.priority ? compareBy(ORDER[input.priority]) : balancedOrder(eligible);
  eligible.sort(order);

  const top = eligible[0];
  const ordered: Ranked[] = eligible.map((s, i) => ({
    candidate: s.c,
    rank: i + 1,
    km: s.km,
    perNightMinor: s.perNightMinor,
    reason:
      i === 0
        ? topReason(input.priority, s, distanceFrom)
        : {
            kind: 'runner_up',
            price_delta_minor: s.c.totalMinor - top.c.totalMinor,
            km_delta: s.km !== null && top.km !== null ? round1(s.km - top.km) : null,
            rating_delta: s.c.rating !== null && top.c.rating !== null ? round1(s.c.rating - top.c.rating) : null,
          },
  }));

  return {
    shortlist: ordered.slice(0, input.size ?? 5),
    ordered,
    eligible: eligible.length,
    rejected,
    uncheckable,
    distanceFrom,
  };
}

/** True when `a` is at least as good as `b` on all four metrics and better on one. */
export function dominates(
  a: { totalMinor: number; km: number | null; rating: number | null; reviewCount: number | null },
  b: { totalMinor: number; km: number | null; rating: number | null; reviewCount: number | null },
): boolean {
  const ak = a.km ?? Number.POSITIVE_INFINITY;
  const bk = b.km ?? Number.POSITIVE_INFINITY;
  const ar = a.rating ?? Number.NEGATIVE_INFINITY;
  const br = b.rating ?? Number.NEGATIVE_INFINITY;
  const an = a.reviewCount ?? Number.NEGATIVE_INFINITY;
  const bn = b.reviewCount ?? Number.NEGATIVE_INFINITY;
  const noWorse = a.totalMinor <= b.totalMinor && ak <= bk && ar >= br && an >= bn;
  const better = a.totalMinor < b.totalMinor || ak < bk || ar > br || an > bn;
  return noWorse && better;
}

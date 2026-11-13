import { AMENITIES, type Amenity, type MustHave } from '@/lib/amenities';
import { knownRating, knownStars, NO_FILTERS, type ListedPropertyType, type PropertyType, type StayFilters } from '@/lib/filters';
import { isMemberOnlyPrice } from '@/lib/pricing';
import { haversineKm, medianPoint, nightsBetween, type LatLng } from './geo';

/**
 * The stay finder's ranking. Pure: candidates in, a ranked shortlist with a
 * machine-readable reason per row out. No I/O, no clock, no model.
 *
 * Two properties are tested for every set of priorities:
 *  - nothing on the shortlist violates a hard constraint;
 *  - DOMINANCE: a hotel that is no worse on price, distance, rating and review
 *    count than another, and better on at least one, never ranks below it.
 */

export const PRIORITY_KEYS = ['cheapest', 'closest', 'nicest'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];

/** The order priorities are reported and tie-broken in, whatever order they were picked in. */
export const CANONICAL_PRIORITIES: readonly PriorityKey[] = ['cheapest', 'nicest', 'closest'];

/** A set of priorities in canonical order, without duplicates. */
export function canonicalPriorities(priorities: readonly PriorityKey[]): PriorityKey[] {
  return CANONICAL_PRIORITIES.filter((k) => priorities.includes(k));
}

/** Where "close" is measured from. `place` = the user named it; `destination` = the destination's own map point. */
export type NearTarget = { point: LatLng; label: string | null; from: 'place' | 'destination' };
export type DistanceFrom = 'place' | 'destination' | 'search_centre';

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
  /** What kind of place the listing says it is. null or absent = it does not say. */
  propertyType?: ListedPropertyType | null;
  /** The supplier's chain name. null or absent = the listing names none. */
  chain?: string | null;
};

export type RankInput = {
  candidates: Candidate[];
  checkIn: string;
  checkOut: string;
  /**
   * What "best" means to the user, as a set: the order it was picked in never
   * matters. Empty = not said, or "no preference": a balanced order.
   */
  priorities: readonly PriorityKey[];
  mustHaves: readonly MustHave[];
  /** Per night for the whole party, minor units. */
  priceCapMinor: number | null;
  /** Where distance is measured from. null = the middle of the results (the last resort). */
  near: NearTarget | null;
  /** Anonymous visitors may not be shown a price under the hotel's public price. */
  audience: 'public' | 'member';
  excludedPropertyIds?: readonly string[];
  /** Star class, rating, kind of place, brand (lib/filters.ts). Absent = none. */
  filters?: StayFilters;
  size?: number;
  /** When fewer hotels than this fit, the nearest misses fill the list up to it. */
  minShown?: number;
};

/**
 * Never a list of one: when fewer than this many hotels fit, the ones that
 * miss by the least are shown under them, each saying what it misses, so the
 * user can see what loosening a constraint would buy.
 */
export const MIN_SHOWN = 5;

/**
 * One constraint a near-miss fails. `member_price` carries no number: that
 * price may not be shown to an anonymous visitor in any form.
 */
export type Miss =
  | { kind: 'over_price_cap'; over_by_minor: number }
  /** `must`: known to be lacking. `unknown`: the supplier sent no amenity list, so it cannot be checked. */
  | { kind: 'missing_must_have'; must: MustHave[]; unknown: MustHave[] }
  | { kind: 'member_price' }
  /** The filters (lib/filters.ts). The listed value is null when the listing does not say: unknown, not failing. */
  | { kind: 'below_stars'; min: number; stars: number | null }
  | { kind: 'below_rating'; min: number; rating: number | null }
  | { kind: 'not_property_type'; wanted: PropertyType[]; listed: ListedPropertyType | null }
  | { kind: 'not_chain'; wanted: string[]; listed: string | null };

const FILTER_MISSES: ReadonlyArray<Miss['kind']> = ['below_stars', 'below_rating', 'not_property_type', 'not_chain'];

/** What a candidate misses of the filters, in the order the filters are listed. A silent listing misses, with its value null. */
export function filterMisses(c: Candidate, f: StayFilters): Miss[] {
  const out: Miss[] = [];
  const stars = knownStars(c.stars);
  if (f.minStars !== null && (stars === null || stars < f.minStars)) out.push({ kind: 'below_stars', min: f.minStars, stars });
  const rating = knownRating(c.rating);
  if (f.minRating !== null && (rating === null || rating < f.minRating)) out.push({ kind: 'below_rating', min: f.minRating, rating });
  const type = c.propertyType ?? null;
  if (f.propertyTypes.length > 0 && (type === null || !(f.propertyTypes as readonly string[]).includes(type))) {
    out.push({ kind: 'not_property_type', wanted: [...f.propertyTypes], listed: type });
  }
  const chain = c.chain ?? null;
  if (f.chains.length > 0 && (chain === null || !f.chains.some((w) => w.toLowerCase() === chain.toLowerCase()))) {
    out.push({ kind: 'not_chain', wanted: [...f.chains], listed: chain });
  }
  return out;
}

export type NearMiss = {
  candidate: Candidate;
  /** Continues after the shortlist's ranks. */
  rank: number;
  misses: Miss[];
  km: number | null;
  perNightMinor: number;
};

export type RejectionReason = 'over_price_cap' | 'missing_must_have' | 'filtered_out' | 'below_public_price' | 'excluded_by_user';

export type Reason =
  | { kind: 'cheapest_meeting_all_musts' }
  | { kind: 'closest'; km: number; to: DistanceFrom; to_label: string | null }
  | { kind: 'best_rated'; rating: number; reviews: number | null }
  | {
      kind: 'best_mix';
      /** The priorities it balanced, canonical order. */
      of: PriorityKey[];
      km: number | null;
      to: DistanceFrom | null;
      to_label: string | null;
      rating: number | null;
      reviews: number | null;
      /** 1 = cheapest of the eligible hotels. A rank, never an amount. */
      price_rank: number;
      eligible: number;
    }
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
  /** Shown under the shortlist when it is shorter than `minShown`: fewest misses first, then the same order. Never a hotel the user set aside. */
  nearMisses: NearMiss[];
  /** Every eligible candidate in order: the shortlist is its head. */
  ordered: Ranked[];
  eligible: number;
  rejected: Record<RejectionReason, number>;
  /** Which must-haves could not be checked for at least one hotel (amenities unknown). */
  uncheckable: number;
  /** Hotels left out by a filter only because their listing does not hold the field (no star class, no type, no chain). */
  filterUnknown: number;
  distanceFrom: DistanceFrom | null;
  distanceLabel: string | null;
};

const BREAKFAST = /breakfast|half board|full board|all inclusive/i;

/** A board name that says breakfast comes with the rate. "Room Only (breakfast available at a surcharge)" does not. */
export function includesBreakfast(boardName: string | null): boolean {
  return boardName !== null && BREAKFAST.test(boardName) && !/room only/i.test(boardName);
}

export function meetsMustHave(c: Candidate, must: MustHave): boolean {
  if (must === 'free_cancellation') return c.refundable;
  if (must === 'breakfast_included') return includesBreakfast(c.boardName);
  // An amenity we have no data for is not claimed: unknown fails the must-have.
  return c.amenities !== null && (AMENITIES as readonly string[]).includes(must) && c.amenities.includes(must);
}

type Scored = { c: Candidate; km: number | null; perNightMinor: number };

/** Higher is better for rating and reviews; unknown sorts last. */
const price = (s: Scored) => s.c.totalMinor;
const dist = (s: Scored) => s.km ?? Number.POSITIVE_INFINITY;
const rating = (s: Scored) => -(s.c.rating ?? Number.NEGATIVE_INFINITY);
const reviews = (s: Scored) => -(s.c.reviewCount ?? Number.NEGATIVE_INFINITY);

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
};

/** The one metric each priority is scored on when several are combined. */
const METRIC: Record<PriorityKey, Key> = { cheapest: price, nicest: rating, closest: dist };

/**
 * Two or three priorities: an equal-weight sum of rank percentiles over the
 * selected metrics, lower is better.
 *
 * Percentile, not min-max: one 900-euro suite must not squash everyone else's
 * price spread. Kept in integers (twice the "better than" count plus ties,
 * all over the same denominator), so adding a hotel worse on everything
 * cannot reorder the rest and no float rounding can flip a tie.
 *
 * Dominance-safe: a dominating hotel is no worse on any metric, so its score
 * is no higher, and an equal score falls to a chain ending in all four metrics.
 */
function mixedOrder(scored: Scored[], selected: PriorityKey[]): (a: Scored, b: Scored) => number {
  const score = new Map<Scored, number>();
  for (const s of scored) score.set(s, 0);
  for (const key of selected) {
    const metric = METRIC[key];
    const values = scored.map(metric);
    scored.forEach((s, i) => {
      let better = 0;
      let ties = 0;
      for (const v of values) {
        if (v < values[i]) better += 1;
        else if (v === values[i]) ties += 1;
      }
      // (2 * better + (ties - 1)) / (2 * (n - 1)): the denominator is shared, so drop it.
      score.set(s, score.get(s)! + 2 * better + (ties - 1));
    });
  }
  const unselected = CANONICAL_PRIORITIES.filter((k) => !selected.includes(k));
  const tieBreak = compareBy([...selected.map((k) => METRIC[k]), ...unselected.map((k) => METRIC[k]), reviews]);
  return (a, b) => {
    const x = score.get(a)!;
    const y = score.get(b)!;
    return x !== y ? (x < y ? -1 : 1) : tieBreak(a, b);
  };
}

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

function topReason(
  selected: PriorityKey[],
  top: Scored,
  all: Scored[],
  from: DistanceFrom | null,
  label: string | null,
): Reason {
  if (selected.length > 1) {
    return {
      kind: 'best_mix',
      of: selected,
      km: top.km,
      to: top.km !== null ? from : null,
      to_label: top.km !== null && from !== 'search_centre' ? label : null,
      rating: top.c.rating,
      reviews: top.c.reviewCount,
      price_rank: 1 + all.filter((s) => s.c.totalMinor < top.c.totalMinor).length,
      eligible: all.length,
    };
  }
  switch (selected[0]) {
    case 'cheapest':
      return { kind: 'cheapest_meeting_all_musts' };
    case 'closest':
      return top.km !== null && from
        ? { kind: 'closest', km: top.km, to: from, to_label: from === 'search_centre' ? null : label }
        : { kind: 'best_balance' };
    case 'nicest':
      return top.c.rating !== null
        ? { kind: 'best_rated', rating: top.c.rating, reviews: top.c.reviewCount }
        : { kind: 'best_balance' };
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
    filtered_out: 0,
    below_public_price: 0,
    excluded_by_user: 0,
  };
  let uncheckable = 0;
  let filterUnknown = 0;
  const filters = input.filters ?? NO_FILTERS;

  // Distances are measured from the place the user named, else from the
  // destination's own map point, else (no point known) from the middle of
  // what the search returned. The reason says which.
  const located = input.candidates.flatMap((c) => (c.location ? [c.location] : []));
  const centre = input.near?.point ?? medianPoint(located);
  const distanceFrom: DistanceFrom | null = input.near ? input.near.from : centre ? 'search_centre' : null;
  const distanceLabel = input.near?.label ?? null;
  const selected = canonicalPriorities(input.priorities);

  const eligible: Scored[] = [];
  const missed: Array<Scored & { misses: Miss[] }> = [];
  for (const c of input.candidates) {
    if (excluded.has(c.propertyId)) {
      rejected.excluded_by_user += 1;
      continue;
    }
    const perNightMinor = Math.ceil(c.totalMinor / nights);
    const misses: Miss[] = [];
    if (isMemberOnlyPrice(c, input.audience)) {
      misses.push({ kind: 'member_price' });
    }
    if (input.priceCapMinor !== null && perNightMinor > input.priceCapMinor) {
      misses.push({ kind: 'over_price_cap', over_by_minor: perNightMinor - input.priceCapMinor });
    }
    const lacking = input.mustHaves.filter((m) => !meetsMustHave(c, m));
    if (lacking.length > 0) {
      const isUnknown = (m: MustHave) => c.amenities === null && (AMENITIES as readonly string[]).includes(m);
      misses.push({ kind: 'missing_must_have', must: lacking.filter((m) => !isUnknown(m)), unknown: lacking.filter(isUnknown) });
    }
    const filtered = filterMisses(c, filters);
    misses.push(...filtered);
    if (filtered.length > 0 && filtered.every(isSilent)) filterUnknown += 1;
    // Rounded to 100 m HERE, before ranking: the order is decided on the same
    // number the user is shown. Ranking on the exact distance put a dearer,
    // worse-rated hotel first for being 20 m closer while both read "0.5 km".
    const scored = { c, km: centre && c.location ? round1(haversineKm(centre, c.location)) : null, perNightMinor };
    if (misses.length === 0) {
      eligible.push(scored);
      continue;
    }
    // Counted once, by the first constraint it fails, in this order.
    const first = misses[0].kind;
    if (first === 'member_price') rejected.below_public_price += 1;
    else if (first === 'over_price_cap') rejected.over_price_cap += 1;
    else if (FILTER_MISSES.includes(first)) rejected.filtered_out += 1;
    else {
      rejected.missing_must_have += 1;
      if (misses[0].kind === 'missing_must_have' && misses[0].unknown.length > 0) uncheckable += 1;
    }
    missed.push({ ...scored, misses });
  }

  const orderFor = (pool: Scored[]) =>
    selected.length === 0 ? balancedOrder(pool) : selected.length === 1 ? compareBy(ORDER[selected[0]]) : mixedOrder(pool, selected);
  eligible.sort(orderFor(eligible));

  const top = eligible[0];
  const ordered: Ranked[] = eligible.map((s, i) => ({
    candidate: s.c,
    rank: i + 1,
    km: s.km,
    perNightMinor: s.perNightMinor,
    reason:
      i === 0
        ? topReason(selected, s, eligible, distanceFrom, distanceLabel)
        : {
            kind: 'runner_up',
            price_delta_minor: s.c.totalMinor - top.c.totalMinor,
            km_delta: s.km !== null && top.km !== null ? round1(s.km - top.km) : null,
            rating_delta: s.c.rating !== null && top.c.rating !== null ? round1(s.c.rating - top.c.rating) : null,
          },
  }));

  const shortlist = ordered.slice(0, input.size ?? 5);
  const missOrder = orderFor(missed);
  missed.sort((a, b) => a.misses.length - b.misses.length || missOrder(a, b));
  const nearMisses: NearMiss[] = missed
    .slice(0, Math.max(0, (input.minShown ?? MIN_SHOWN) - shortlist.length))
    .map((s, i) => ({ candidate: s.c, rank: shortlist.length + i + 1, misses: s.misses, km: s.km, perNightMinor: s.perNightMinor }));

  return {
    shortlist,
    nearMisses,
    ordered,
    eligible: eligible.length,
    rejected,
    uncheckable,
    filterUnknown,
    distanceFrom,
    distanceLabel: distanceFrom === 'search_centre' ? null : distanceLabel,
  };
}

/** A filter missed only because the listing does not hold the field. */
function isSilent(m: Miss): boolean {
  switch (m.kind) {
    case 'below_stars':
      return m.stars === null;
    case 'below_rating':
      return m.rating === null;
    case 'not_property_type':
    case 'not_chain':
      return m.listed === null;
    default:
      return false;
  }
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

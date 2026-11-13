import { copy, joinList } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';

/**
 * The filters beside the price cap and the must-haves: a star class, a guest
 * rating, a kind of place and a brand. Each one reads a field the supplier's
 * listing carries (docs/finder.md, "Filters"). A hotel whose listing does not
 * hold the field is never dropped silently: it misses the filter as
 * "the listing does not say", and its card says so.
 *
 * Neighbourhood is deliberately absent: no listing field names one (only a
 * street address and a postcode), so "close to" a named place (set_near) is
 * the honest way to ask for an area.
 */

/**
 * The kinds of place a user can pick. Each is backed by the supplier's own
 * type ids (server/supplier/liteapi/propertyTypes.ts), and only kinds seen in
 * the supplier's Porto, Lisbon and Barcelona lists are offered.
 */
export const PROPERTY_TYPES = ['hotel', 'aparthotel', 'apartment', 'hostel', 'bed_and_breakfast', 'guest_house', 'holiday_home'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
/** What a listing says it is: one of the kinds above, or a kind not offered as a filter (a houseboat, a homestay). */
export type ListedPropertyType = PropertyType | 'other';

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value);
}
export function isListedPropertyType(value: unknown): value is ListedPropertyType {
  return value === 'other' || isPropertyType(value);
}

/** Singular, for a card ("it is a hostel") and a chip. */
export const PROPERTY_TYPE_LABEL: Record<ListedPropertyType, string> = {
  hotel: 'hotel',
  aparthotel: 'aparthotel',
  apartment: 'apartment',
  hostel: 'hostel',
  bed_and_breakfast: 'B&B',
  guest_house: 'guest house',
  holiday_home: 'holiday home',
  other: 'another kind of place',
};

/** "a hostel", "an apartment". */
export const aKind = (t: ListedPropertyType, locale: Locale = 'en') => copy(locale).filters.typeWithArticle[t];
/** The plural in the locale ("hotels", "hoteles"). The English table is PROPERTY_TYPE_PLURAL. */
export const typePlural = (t: PropertyType, locale: Locale = 'en') => copy(locale).filters.typePlural[t];

/** Plural, for a list ("Hotels or apartments"). */
export const PROPERTY_TYPE_PLURAL: Record<PropertyType, string> = {
  hotel: 'hotels',
  aparthotel: 'aparthotels',
  apartment: 'apartments',
  hostel: 'hostels',
  bed_and_breakfast: 'B&Bs',
  guest_house: 'guest houses',
  holiday_home: 'holiday homes',
};

/** The star classes offered as a minimum ("4+ stars"). 5 means five only. */
export const STAR_STEPS = [3, 4, 5] as const;
/** The guest ratings offered as a minimum, on the supplier's 10-point scale. */
export const RATING_STEPS = [7, 8, 9] as const;
export const MAX_CHAINS = 10;

export type StayFilters = {
  /** null = any. A listing with no star class (none, or 0) cannot be checked. */
  minStars: number | null;
  /** null = any. Out of 10. */
  minRating: number | null;
  /** [] = any kind. Several = any of them. */
  propertyTypes: PropertyType[];
  /** [] = any brand. The supplier's own chain names, exactly as listed. */
  chains: string[];
};

export const NO_FILTERS: StayFilters = { minStars: null, minRating: null, propertyTypes: [], chains: [] };

/** A star class the listing states. The supplier sends 0 for "not rated", which is not a class. */
export const knownStars = (stars: number | null | undefined): number | null => (typeof stars === 'number' && stars > 0 ? stars : null);
export const knownRating = (rating: number | null | undefined): number | null => (typeof rating === 'number' && rating > 0 ? rating : null);

/** "A", "A or B", "A, B or C". */
export function eitherOf(names: string[], locale: Locale = 'en'): string {
  return joinList(names, locale, 'or');
}

/** "4+ stars", "5 stars". */
export const starsChip = (min: number, locale: Locale = 'en') => copy(locale).filters.starsChip(min);
/** "Rated 8+". */
export const ratingChip = (min: number, locale: Locale = 'en') => copy(locale).filters.ratingChip(min);
/** "Hotels or apartments". */
export function typesChip(types: readonly PropertyType[], locale: Locale = 'en'): string {
  const words = types.map((t) => typePlural(t, locale));
  const text = eitherOf(words, locale);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** "Mercure or YOTEL". */
export const chainsChip = (chains: readonly string[], locale: Locale = 'en') => eitherOf([...chains], locale);

/** The filters as a stay row stores them (jsonb lists are read back as strings and checked). */
export function stayFilters(row: { minStars: number | null; minRating: number | null; propertyTypes: readonly string[]; chains: readonly string[] }): StayFilters {
  return {
    minStars: row.minStars,
    minRating: row.minRating,
    propertyTypes: PROPERTY_TYPES.filter((t) => row.propertyTypes.includes(t)),
    chains: [...row.chains].sort(),
  };
}

export const hasFilters = (f: StayFilters) => f.minStars !== null || f.minRating !== null || f.propertyTypes.length > 0 || f.chains.length > 0;

export type FilterOptions = {
  /** Kinds of place among the hotels held for this search, with how many of each. */
  propertyTypes: Array<{ type: PropertyType; count: number }>;
  /** Chains among them, most hotels first. */
  chains: Array<{ chain: string; count: number }>;
  /** How many held hotels name no kind / no chain: a filter on it would leave them out, and the editor says so. */
  silent: { propertyType: number; chain: number };
};

/** What the type and brand editors offer: only values the held listings carry. */
export function filterOptions(hotels: ReadonlyArray<{ propertyType: ListedPropertyType | null; chain: string | null }>): FilterOptions {
  const types = new Map<PropertyType, number>();
  const chains = new Map<string, number>();
  let noType = 0;
  let noChain = 0;
  for (const h of hotels) {
    if (h.propertyType === null) noType += 1;
    else if (h.propertyType !== 'other') types.set(h.propertyType, (types.get(h.propertyType) ?? 0) + 1);
    if (h.chain === null) noChain += 1;
    else chains.set(h.chain, (chains.get(h.chain) ?? 0) + 1);
  }
  return {
    propertyTypes: PROPERTY_TYPES.filter((t) => types.has(t)).map((type) => ({ type, count: types.get(type)! })),
    chains: [...chains].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([chain, count]) => ({ chain, count })),
    silent: { propertyType: noType, chain: noChain },
  };
}

/** What the static facts said a hotel is (the finder writes it into the property's `content`). Absent = the listing does not say. */
export function readPropertyType(content: Record<string, unknown> | null): ListedPropertyType | null {
  const raw = content?.propertyType;
  return isListedPropertyType(raw) ? raw : null;
}

/** The chain the static facts named, or null. */
export function readChain(content: Record<string, unknown> | null): string | null {
  const raw = content?.chain;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

import type { Amenity, MustHave } from '@/lib/amenities';
import { chainsChip, eitherOf, hasFilters, typePlural, type StayFilters } from '@/lib/filters';
import type { Answer, RankValue } from '@/lib/answers';
import { nightsBetween } from '@/lib/finder/geo';
import { canonicalPriorities, type DistanceFrom, type PriorityKey } from '@/lib/finder/rank';
import { placeName } from '@/lib/finder/searchPlan';
import { copy, formatCount, joinList } from '@/lib/i18n';
import { en } from '@/lib/i18n/catalogue/en';
import { INTL, type Locale } from '@/lib/i18n/locale';
import type { SearchField } from '@/lib/router/catalogue';
import type { FactAsk } from '@/lib/router/route';
import { sightsInPlay, type SightKind } from '@/lib/sights';
import type { ResolvedAction } from '@/lib/store/actions';
import type { Applied, Rejection, SearchState } from '@/lib/store/reduce';

/**
 * What the app says after a change it made WITHOUT a model: fixed templates
 * over typed values. A line states what changed (and what misses, when too few fit);
 * prices and terms stay on the cards, which render them from offer rows.
 * Copy rule: every line tells the user something they cannot already see.
 *
 * Every function takes the locale last (English when left out). The words
 * come from the catalogues (lib/i18n/catalogue); which words make a line is
 * decided here, once, for every language.
 */

/** How many sights a line names; the rest are counted. */
export const SIGHTS_NAMED = 4;

/** English tables, for callers and tests that only ever speak English. */
export const MUST_HAVE_LABEL: Record<MustHave, string> = en.replies.mustHave;
export const PRIORITY_CHIP: Record<PriorityKey, string> = en.replies.priorityChip;
export const REJECTION_LINE: Record<Rejection, string> = en.replies.rejection;
/** Fixed lines for messages the app handles without a model (English; `fixedLine` for any language). */
export const FIXED_LINES = en.replies.fixed;
export type FixedLine = keyof typeof FIXED_LINES;

export const mustHaveLabel = (m: MustHave, locale: Locale = 'en'): string => copy(locale).replies.mustHave[m];
/** A facility as an answer names it (a noun phrase in every language). */
const facilityName = (a: Amenity, locale: Locale): string => copy(locale).answers.facility[a];
export const rejectionLine = (r: Rejection, locale: Locale = 'en'): string => copy(locale).replies.rejection[r];
export const fixedLine = (key: FixedLine, locale: Locale = 'en'): string => copy(locale).replies.fixed[key];

/** Where "close" is measured from, in words: the place named, else the destination's centre (or the point itself). */
export function nearLabel(
  stay: { destinationText: string; destKind: 'area' | 'point' | null; near: { label: string } | null; sights?: { kind: SightKind } | null },
  locale: Locale = 'en',
): string {
  // The sights' own label is stored in English; the kind says it in any language.
  if (stay.sights) return copy(locale).sights.near[stay.sights.kind];
  if (stay.near) return stay.near.label;
  return stay.destKind === 'point' ? placeName(stay.destinationText) : copy(locale).words.centre(placeName(stay.destinationText));
}

/** "Low price · Close to Annecy centre", or "Balanced" for no preference. */
export function prioritiesLabel(priorities: readonly PriorityKey[], near: string, locale: Locale = 'en'): string {
  const c = copy(locale).replies;
  const set = canonicalPriorities(priorities);
  if (set.length === 0) return c.balanced;
  return set.map((k) => (k === 'closest' ? c.closeTo(near) : c.priorityChip[k])).join(' · ');
}

/** The reply line for a changed set of priorities. */
export function prioritiesLine(priorities: readonly PriorityKey[], near: string, locale: Locale = 'en'): string {
  const c = copy(locale).replies;
  const set = canonicalPriorities(priorities);
  if (set.length === 0) return c.balancedLine;
  return c.rankedFor(joinList(set.map((k) => (k === 'closest' ? c.beingCloseTo(near) : c.priorityWord[k])), locale));
}

export function formatMoney(amountMinor: number, currency: string, locale: Locale = 'en'): string {
  const tag = INTL[locale].number;
  const digits = new Intl.NumberFormat(tag, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = amountMinor / 10 ** digits;
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** One day in the locale's short form: "11 Dec", "11 dic". */
export function formatDay(iso: string, locale: Locale = 'en', withMonth = true): string {
  return new Intl.DateTimeFormat(INTL[locale].date, { day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(/\.$/, '');
}

export function formatDates(checkIn: string, checkOut: string, locale: Locale = 'en'): string {
  const nights = nightsBetween(checkIn, checkOut);
  const sameMonth = checkIn.slice(0, 7) === checkOut.slice(0, 7);
  return `${formatDay(checkIn, locale, !sameMonth)}–${formatDay(checkOut, locale)}, ${copy(locale).words.nights(nights)}`;
}

/** A rooms stepper's value: "Best price" until the user picks a number (lib/finder/rooms.ts). */
export function roomsShown(rooms: number | null, locale: Locale = 'en'): string {
  return rooms === null ? copy(locale).replies.bestPrice : String(rooms);
}

/** `rooms` null: nobody fixed the rooms, and each hotel's card says which it priced. */
export function formatGuests(adults: number, childrenAges: number[], rooms: number | null, locale: Locale = 'en'): string {
  const w = copy(locale).words;
  const parts = [w.adults(adults)];
  if (childrenAges.length > 0) parts.push(w.children(childrenAges.length, childrenAges.join(', ')));
  if (rooms !== null && rooms > 1) parts.push(w.rooms(rooms));
  return parts.join(', ');
}

function actionLine(action: ResolvedAction, state: SearchState, currency: string, locale: Locale): string {
  const c = copy(locale).replies;
  switch (action.type) {
    case 'set_priorities':
      return prioritiesLine(action.priorities, nearLabel(state.stay, locale), locale);
    case 'set_near':
      return c.closeToLine(action.near.label);
    case 'clear_near':
    case 'clear_sights':
      return c.closeAgain(nearLabel(state.stay, locale));
    case 'set_sights': {
      // The names are Google's rows, the ones this stay has time for (lib/sights.ts).
      const t = copy(locale).sights;
      const names = sightsInPlay(action.sights, nightsBetween(state.stay.checkIn, state.stay.checkOut)).map((p) => p.name);
      // The four best known by name; the plan lists every one.
      const said = names.slice(0, SIGHTS_NAMED);
      return t.line(t.popular[action.sights.kind], placeName(state.stay.destinationText), joinList(said, locale), names.length - said.length);
    }
    case 'set_price_cap':
      return action.perNightMinor === null ? c.capRemoved : c.cappedAt(formatMoney(action.perNightMinor, currency, locale));
    case 'add_must_have':
      return c.mustHaveLine(c.mustHave[action.mustHave]);
    case 'remove_must_have':
      return c.noLongerRequiring(c.mustHave[action.mustHave]);
    case 'set_min_stars':
      return action.stars === null ? c.anyStars : c.only(starsFloor(action.stars, locale));
    case 'set_min_rating':
      return action.rating === null ? c.anyRating : c.only(ratingFloor(action.rating, locale));
    case 'set_property_types':
      return action.types.length === 0 ? c.anyKind : c.only(eitherOf(state.stay.filters.propertyTypes.map((t) => typePlural(t, locale)), locale));
    case 'set_chains':
      return action.chains.length === 0 ? c.anyBrand : c.only(chainsChip(state.stay.filters.chains, locale));
    case 'set_guests':
      return `${formatGuests(action.adults, action.childrenAges, action.rooms, locale)}.`;
    case 'set_dates':
      return `${formatDates(action.checkIn, action.checkOut, locale)}.`;
    case 'set_destination':
      return c.searching(state.stay.destinationText);
    case 'set_nationality':
      return '';
    case 'set_currency':
      return c.pricesIn(action.code);
    case 'exclude_property':
      return c.setAside;
    case 'more_options':
      return c.thoseSetAside;
    case 'reset_exclusions':
      return c.everythingBack;
  }
}

export type OutcomeForReply =
  | { kind: 'ok'; shortlisted: number; nearMisses?: number; eligible: number; rejected: Record<string, number>; uncheckable: number; filterUnknown?: number; amenityFactsMissing: boolean }
  | { kind: 'no_availability' | 'needs_place' | 'needs_nationality' | 'not_found' }
  | { kind: 'supplier_error'; error: { retryable: boolean } };

export function outcomeLine(outcome: OutcomeForReply | null, locale: Locale = 'en'): string {
  if (!outcome) return '';
  const c = copy(locale).replies;
  switch (outcome.kind) {
    case 'ok': {
      const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
      const near = nearMissLine(outcome.nearMisses ?? 0, outcome.eligible, locale);
      // Hotels fit: the list shows them, so the line adds nothing but the misses under them (Sam, 2026-11-13).
      if (outcome.eligible > 0) return near.trim();
      const why: string[] = [];
      if (outcome.rejected.over_price_cap) why.push(c.whyOverCap(outcome.rejected.over_price_cap));
      if (outcome.rejected.missing_must_have) {
        why.push(outcome.amenityFactsMissing ? c.whyUncheckable(outcome.uncheckable) : c.whyLackMust(outcome.rejected.missing_must_have));
      }
      if (outcome.rejected.filtered_out) why.push(c.whyFilteredOut(outcome.rejected.filtered_out, outcome.filterUnknown ?? 0));
      if (outcome.rejected.excluded_by_user) why.push(c.whyYouSetAside(outcome.rejected.excluded_by_user));
      if (outcome.rejected.below_public_price) why.push(c.whyMemberOnly(outcome.rejected.below_public_price));
      if (outcome.rejected.out_of_town) why.push(c.whyOutOfTown(outcome.rejected.out_of_town));
      return `${c.noneFit(considered, why.join(', '))}${near}`;
    }
    case 'no_availability':
      return c.noAvailability;
    case 'supplier_error':
      return outcome.error.retryable ? c.supplierRetry : c.supplierRefused;
    case 'needs_place':
    case 'needs_nationality':
    case 'not_found':
      return '';
  }
}

/** "4 stars and up", "5 stars". */
export const starsFloor = (min: number, locale: Locale = 'en') => copy(locale).replies.starsFloor(min);
/** "Rated 8 and up". */
export const ratingFloor = (min: number, locale: Locale = 'en') => copy(locale).replies.ratingFloor(min);

/** The filters in one sentence, for "what is my search set to?". null when none is set. */
export function filtersLine(f: StayFilters, locale: Locale = 'en'): string | null {
  if (!hasFilters(f)) return null;
  const c = copy(locale).replies;
  const parts: string[] = [];
  if (f.minStars !== null) parts.push(starsFloor(f.minStars, locale).toLowerCase());
  if (f.minRating !== null) parts.push(ratingFloor(f.minRating, locale).toLowerCase());
  if (f.propertyTypes.length) parts.push(eitherOf(f.propertyTypes.map((t) => typePlural(t, locale)), locale));
  if (f.chains.length) parts.push(c.fromBrands(chainsChip(f.chains, locale)));
  return c.showingOnly(parts.join(', '));
}

/** Said when the list is topped up with hotels that miss something (finder/rank.ts MIN_SHOWN). */
export function nearMissLine(nearMisses: number, eligible: number, locale: Locale = 'en'): string {
  if (nearMisses <= 0) return '';
  return copy(locale).replies.nearMiss(nearMisses, eligible);
}

/** The whole reply for a set of applied actions and what the finder then found. */
export function describeChange(results: Applied[], state: SearchState, currency: string, outcome: OutcomeForReply | null, locale: Locale = 'en'): string {
  const lines: string[] = [];
  for (const r of results) lines.push(r.ok ? actionLine(r.action, state, currency, locale) : rejectionLine(r.rejection, locale));
  if (results.some((r) => r.ok)) lines.push(outcomeLine(outcome, locale));
  const said = lines.filter(Boolean).join(' ');
  if (said || !results.some((r) => r.ok) || outcome?.kind !== 'ok' || outcome.eligible === 0) return said;
  // A change with no words of its own (the nationality): never silent, so the count is said after all.
  return copy(locale).replies.fit(outcome.eligible, outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0));
}

/**
 * "Show me all of them" (lib/fullList.ts). Counts come from the finder's rows:
 * `fits` top picks on screen, `more` stored after them.
 */
export function fullListLine(fits: number, more: number, locale: Locale = 'en'): string {
  const c = copy(locale).replies;
  if (more === 0) return fits === 1 ? c.fullListOnlyOne : c.fullListOnScreen(formatCount(fits, locale));
  return c.fullListListed(formatCount(fits + more, locale));
}

/** "save this one": said after the row is written, never before. */
export function savedLine(name: string, locale: Locale = 'en'): string {
  return copy(locale).replies.saved(name);
}

/** "show my saved hotels": names only. Prices are on the list itself, each marked as the last one found. */
export function savedListLine(names: string[], locale: Locale = 'en'): string {
  if (names.length === 0) return fixedLine('saved_none', locale);
  const shown = names.slice(0, 5);
  return copy(locale).replies.savedList(names.length, listNames(shown, locale), names.length - shown.length);
}

/* ------------------------------------------------------------------------
 * Answers to questions about what is on screen (lib/answers.ts). Each line is
 * a template over values read from offer and property rows. A value the row
 * does not hold is said as exactly that; nothing here can state a price, a
 * term or a facility that no row gave.
 * ---------------------------------------------------------------------- */

const km = (v: number, locale: Locale) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toLocaleString(INTL[locale].number, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);

function fromText(from: DistanceFrom, label: string | null, locale: Locale): string {
  const a = copy(locale).answers;
  return from === 'search_centre' ? a.fromSearchCentre : (label ?? (from === 'place' ? a.fromPlace : a.fromDestination));
}

/** An instant with its weekday, always in UTC as the supplier's deadlines are: "Sat 12 Dec, 10:00 UTC", "sáb, 12 dic, 10:00 UTC". */
export function formatInstant(iso: string | Date, locale: Locale = 'en'): string {
  const when = new Intl.DateTimeFormat(INTL[locale].date, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
  return copy(locale).words.deadline(when);
}

export function formatDeadline(iso: string | Date, locale: Locale = 'en'): string {
  const when = new Intl.DateTimeFormat(INTL[locale].date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
  return copy(locale).words.deadline(when);
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[], locale: Locale = 'en'): string {
  return joinList(names, locale);
}

/** What a row was silent about, in the user's terms. */
function notHeldLine(name: string, ask: FactAsk, locale: Locale): string {
  const n = copy(locale).answers.notHeld;
  return ask.fact === 'facility' ? n.facility(name, facilityName(ask.amenity, locale)) : n[ask.fact](name);
}

function rankValueText(v: RankValue, currency: string, locale: Locale): string {
  const a = copy(locale).answers;
  const w = copy(locale).words;
  switch (v.on) {
    case 'price':
      return a.priceFor(formatMoney(v.totalMinor, currency, locale), w.nights(v.nights));
    case 'distance':
      return a.kmFrom(km(v.km, locale), fromText(v.from, v.label, locale));
    case 'rating':
      return v.reviews === null ? a.rated(v.rating) : a.ratedFrom(v.rating, formatCount(v.reviews, locale));
    case 'reviews':
      return w.reviews(formatCount(v.reviews, locale));
    case 'stars':
      return w.stars(v.stars);
  }
}

function searchLine(field: SearchField, s: Extract<Answer, { kind: 'search' }>['search'], currency: string, locale: Locale): string {
  const a = copy(locale).answers;
  const r = copy(locale).replies;
  const dates = `${formatDates(s.checkIn, s.checkOut, locale)}.`;
  const guests = `${formatGuests(s.adults, s.childrenAges, s.rooms, locale)}.`;
  const place = r.searching(s.destinationText);
  const cap = s.priceCapMinor === null ? null : r.cappedAt(formatMoney(s.priceCapMinor, currency, locale));
  const musts = s.mustHaves.length === 0 ? null : r.mustHaveLine(listNames(s.mustHaves.map((m) => mustHaveLabel(m, locale)), locale));
  const order = s.priorities === null ? null : prioritiesLine(s.priorities, s.nearLabel, locale);
  const filters = s.filters ? filtersLine(s.filters, locale) : null;
  switch (field) {
    case 'dates':
      return dates;
    case 'guests':
      return guests;
    case 'destination':
      return place;
    case 'budget':
      return cap ?? a.noCap;
    case 'must_haves':
      return [musts ?? a.noMusts, filters].filter(Boolean).join(' ');
    case 'priority':
      return order ?? a.noOrder;
    case 'everything':
      return [place, dates, guests, cap, musts, filters, order].filter(Boolean).join(' ');
  }
}

/** The words for an answer. Every number and term in it came from a row. */
export function answerLine(a: Answer, currency: string, locale: Locale = 'en'): string {
  const t = copy(locale).answers;
  const w = copy(locale).words;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  switch (a.kind) {
    case 'price': {
      const extra = a.payAtPropertyMinor > 0 ? t.plusPaidAtHotel(money(a.payAtPropertyMinor)) : '';
      return t.price(a.name, money(a.totalMinor), w.nights(a.nights), money(a.perNightMinor), extra);
    }
    case 'cancellation':
      if (!a.refundable) return t.nonRefundable(a.name);
      return a.until === null ? t.refundableNoDeadline(a.name) : t.freeCancellationUntil(a.name, formatDeadline(a.until, locale));
    case 'breakfast':
      return a.included ? t.breakfastIncluded(a.name, a.boardName) : t.breakfastNotIncluded(a.name, a.boardName);
    case 'rating':
      return a.reviews === null ? t.ratingNoCount(a.name, a.rating) : t.rating(a.name, a.rating, formatCount(a.reviews, locale));
    case 'stars':
      return t.stars(a.name, w.stars(a.stars));
    case 'room':
      return t.room(a.name, a.roomName);
    case 'distance':
      return t.distance(a.name, km(a.km, locale), fromText(a.from, a.label, locale));
    case 'facility':
      // "Lists", not "has": this is the supplier's facility list, and its silence is not a no.
      return a.listed ? t.facilityListed(a.name, facilityName(a.amenity, locale)) : t.facilityNotListed(a.name, facilityName(a.amenity, locale));
    case 'not_held':
      return notHeldLine(a.name, a.ask, locale);
    case 'facts':
      return a.answers.map((x) => answerLine(x, currency, locale)).join(' ');
    case 'across': {
      const [yes, no] =
        a.ask.fact === 'facility'
          ? [t.acrossListing(facilityName(a.ask.amenity, locale)), t.acrossNotListing]
          : a.ask.fact === 'breakfast'
            ? [t.acrossBreakfast, t.acrossNoBreakfast]
            : [t.acrossRefundable, t.acrossNonRefundable];
      const parts: string[] = [];
      if (a.yes.length > 0) parts.push(t.acrossGroup(yes, listNames(a.yes, locale)));
      if (a.no.length > 0) parts.push(t.acrossGroup(no, listNames(a.no, locale)));
      if (a.unknown.length > 0) parts.push(t.acrossUnknown(listNames(a.unknown, locale)));
      return parts.join(' ');
    }
    case 'ranking': {
      const missing = a.missing > 0 ? t.rankingMissingCount(a.missing, t.rankingMissing[a.superlative]) : '';
      return `${t.ranking(t.rankingHead[a.superlative], a.of, a.winners.length > 1, listNames(a.winners, locale), rankValueText(a.value, currency, locale))}${missing}`;
    }
    case 'ranking_not_held':
      return t.rankingNotHeld(a.of, t.rankingHas[a.superlative]);
    case 'search':
      return searchLine(a.field, a.search, currency, locale);
  }
}

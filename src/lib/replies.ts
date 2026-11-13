import type { MustHave } from '@/lib/amenities';
import type { Answer, RankValue } from '@/lib/answers';
import { nightsBetween } from '@/lib/finder/geo';
import { canonicalPriorities, type DistanceFrom, type PriorityKey } from '@/lib/finder/rank';
import { centreLabel, placeName } from '@/lib/finder/searchPlan';
import type { SearchField, Superlative } from '@/lib/router/catalogue';
import type { FactAsk } from '@/lib/router/route';
import type { ResolvedAction } from '@/lib/store/actions';
import type { Applied, Rejection, SearchState } from '@/lib/store/reduce';

/**
 * What the app says after a change it made WITHOUT a model: fixed templates
 * over typed values. A line states what changed and how many hotels fit;
 * prices and terms stay on the cards, which render them from offer rows.
 * Copy rule: every line tells the user something they cannot already see.
 */

export const MUST_HAVE_LABEL: Record<MustHave, string> = {
  pets_allowed: 'pets allowed',
  parking: 'parking',
  free_parking: 'free parking',
  pool: 'a pool',
  air_conditioning: 'air conditioning',
  wifi: 'wifi',
  lift: 'a lift',
  wheelchair_accessible: 'wheelchair access',
  family_rooms: 'family rooms',
  soundproof_rooms: 'soundproofed rooms',
  fitness: 'a gym',
  airport_shuttle: 'an airport shuttle',
  free_cancellation: 'free cancellation',
  breakfast_included: 'breakfast included',
};

/** The chip words for each priority (docs/onboarding.md §3.1). "Close to" takes its target. */
export const PRIORITY_CHIP: Record<PriorityKey, string> = {
  cheapest: 'Low price',
  nicest: 'Great reviews',
  closest: 'Close to',
};

/** Where "close" is measured from, in words: the place named, else the destination's centre (or the point itself). */
export function nearLabel(stay: { destinationText: string; destKind: 'area' | 'point' | null; near: { label: string } | null }): string {
  if (stay.near) return stay.near.label;
  return stay.destKind === 'point' ? placeName(stay.destinationText) : centreLabel(stay.destinationText);
}

/** "Low price · Close to Annecy centre", or "Balanced" for no preference. */
export function prioritiesLabel(priorities: readonly PriorityKey[], near: string): string {
  const set = canonicalPriorities(priorities);
  if (set.length === 0) return 'Balanced';
  return set.map((k) => (k === 'closest' ? `Close to ${near}` : PRIORITY_CHIP[k])).join(' · ');
}

/** The reply line for a changed set of priorities. */
export function prioritiesLine(priorities: readonly PriorityKey[], near: string): string {
  const set = canonicalPriorities(priorities);
  if (set.length === 0) return 'Balanced: price, rating and distance.';
  const words: Record<PriorityKey, string> = { cheapest: 'low price', nicest: 'great reviews', closest: `being close to ${near}` };
  const parts = set.map((k) => words[k]);
  return `Ranked for ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}.`;
}

export const REJECTION_LINE: Record<Rejection, string> = {
  dates_in_past: 'Those dates are in the past.',
  checkout_not_after_checkin: 'Check-out has to be after check-in.',
  stay_too_long: 'Stays are limited to 30 nights.',
  more_rooms_than_adults: 'Each room needs at least one adult.',
  near_too_far: 'That place is too far from where you are searching. Start a new search there instead.',
  place_unavailable: 'The place lookup did not answer. Try again in a moment.',
  no_change: 'That is already how the search is set.',
};

export function formatMoney(amountMinor: number, currency: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = amountMinor / 10 ** digits;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDates(checkIn: string, checkOut: string): string {
  const fmt = (iso: string, withMonth: boolean) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const nights = nightsBetween(checkIn, checkOut);
  const sameMonth = checkIn.slice(0, 7) === checkOut.slice(0, 7);
  return `${fmt(checkIn, !sameMonth)}–${fmt(checkOut, true)}, ${nights} night${nights === 1 ? '' : 's'}`;
}

export function formatGuests(adults: number, childrenAges: number[], rooms: number): string {
  const parts = [`${adults} adult${adults === 1 ? '' : 's'}`];
  if (childrenAges.length > 0) parts.push(`${childrenAges.length} child${childrenAges.length === 1 ? '' : 'ren'} (${childrenAges.join(', ')})`);
  if (rooms > 1) parts.push(`${rooms} rooms`);
  return parts.join(', ');
}

function actionLine(action: ResolvedAction, state: SearchState, currency: string): string {
  switch (action.type) {
    case 'set_priorities':
      return prioritiesLine(action.priorities, nearLabel(state.stay));
    case 'set_near':
      return `Close to ${action.near.label}.`;
    case 'clear_near':
      return `Close to ${nearLabel(state.stay)} again.`;
    case 'set_price_cap':
      return action.perNightMinor === null ? 'Price cap removed.' : `Capped at ${formatMoney(action.perNightMinor, currency)} a night.`;
    case 'add_must_have':
      return `Must have ${MUST_HAVE_LABEL[action.mustHave]}.`;
    case 'remove_must_have':
      return `No longer requiring ${MUST_HAVE_LABEL[action.mustHave]}.`;
    case 'set_guests':
      return `${formatGuests(action.adults, action.childrenAges, action.rooms)}.`;
    case 'set_dates':
      return `${formatDates(action.checkIn, action.checkOut)}.`;
    case 'set_destination':
      return `Searching ${state.stay.destinationText}.`;
    case 'set_nationality':
      return '';
    case 'exclude_property':
      return 'Set aside.';
    case 'more_options':
      return 'Those are set aside.';
    case 'reset_exclusions':
      return 'Everything is back in.';
  }
}

export type OutcomeForReply =
  | { kind: 'ok'; shortlisted: number; nearMisses?: number; eligible: number; rejected: Record<string, number>; uncheckable: number; amenityFactsMissing: boolean }
  | { kind: 'no_availability' | 'needs_place' | 'needs_nationality' | 'not_found' }
  | { kind: 'supplier_error'; error: { retryable: boolean } };

export function outcomeLine(outcome: OutcomeForReply | null): string {
  if (!outcome) return '';
  switch (outcome.kind) {
    case 'ok': {
      const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
      const near = nearMissLine(outcome.nearMisses ?? 0, outcome.eligible);
      if (outcome.eligible > 0) return `${outcome.eligible} of ${considered} hotels fit.${near}`;
      const why: string[] = [];
      if (outcome.rejected.over_price_cap) why.push(`${outcome.rejected.over_price_cap} are over the price cap`);
      if (outcome.rejected.missing_must_have) {
        why.push(
          outcome.amenityFactsMissing
            ? `the must-haves could not be checked for ${outcome.uncheckable}`
            : `${outcome.rejected.missing_must_have} lack a must-have`,
        );
      }
      if (outcome.rejected.excluded_by_user) why.push(`${outcome.rejected.excluded_by_user} you set aside`);
      if (outcome.rejected.below_public_price) why.push(`${outcome.rejected.below_public_price} have a member price only`);
      return `None of ${considered} hotels fit${why.length ? `: ${why.join(', ')}` : ''}.${near}`;
    }
    case 'no_availability':
      return 'No rooms came back for these dates. Send the message again or change the dates.';
    case 'supplier_error':
      return outcome.error.retryable ? 'The hotel search did not answer. Send that again.' : 'The hotel search refused the request.';
    case 'needs_place':
    case 'needs_nationality':
    case 'not_found':
      return '';
  }
}

/** Said when the list is topped up with hotels that miss something (finder/rank.ts MIN_SHOWN). */
export function nearMissLine(nearMisses: number, eligible: number): string {
  if (nearMisses <= 0) return '';
  const what = nearMisses === 1 ? 'the closest miss is' : `the ${nearMisses} closest misses are`;
  return eligible > 0
    ? ` Under ${eligible === 1 ? 'it' : 'them'}, ${what} listed, each saying what it misses.`
    : ` ${what.charAt(0).toUpperCase()}${what.slice(1)} listed, each saying what it misses.`;
}

/** The whole reply for a set of applied actions and what the finder then found. */
export function describeChange(results: Applied[], state: SearchState, currency: string, outcome: OutcomeForReply | null): string {
  const lines: string[] = [];
  for (const r of results) lines.push(r.ok ? actionLine(r.action, state, currency) : REJECTION_LINE[r.rejection]);
  if (results.some((r) => r.ok)) lines.push(outcomeLine(outcome));
  return lines.filter(Boolean).join(' ');
}

/** Fixed lines for messages the app handles without a model. */
export const FIXED_LINES = {
  greeting: 'Tell me what to change: the price, what the hotel must have, or which one to drop.',
  adjacent: 'I only search hotels, so I cannot help with that.',
  cannot_yet: 'I could not work that one out. Try one change at a time, such as "under 120 a night", "needs parking" or "not the second one".',
  router_unavailable: 'The router that handles simple changes did not answer, so nothing was changed. Send that again.',
  router_not_configured: 'Messages are handled by Jev, and JEV_API_KEY is not set on this server, so nothing was changed.',
  use_the_form: 'Pick one of the options above to continue.',
  tap_the_nights: 'That did not give two dates. Tap the first night above, or say it another way: 12 to 15 March.',
  say_who: 'That did not say who is travelling. Set it above, or say it another way: two adults and a dog.',
  agent_unavailable: 'The assistant did not answer, so nothing was changed. Send that again.',
  agent_misconfigured: 'The assistant is set up wrongly on this server (its API key was refused), so nothing was changed. Sending again will not help.',
  agent_not_configured: 'That needs the assistant, and ANTHROPIC_API_KEY is not set on this server, so nothing was changed.',
  ai_budget: 'This search has used its allowance for typed requests today. The buttons and filters still work.',
  which_place: 'Which city or area?',
  confirm: 'Shall I go ahead with that?',
  stage_dropped: 'Left as it was.',
  stage_lapsed: 'The search has changed since I asked, so I have not applied that. Say what you want and I will do it.',
  out_of_time: 'That took too long, so I stopped before changing anything. Send it again.',
  idea_noted: 'I cannot do that yet. I have passed it on to the people who build this.',
  map_shown: 'The map is showing.',
  map_hidden: 'The map is folded away. Say "show the map" to bring it back.',
} as const;

/* ------------------------------------------------------------------------
 * Answers to questions about what is on screen (lib/answers.ts). Each line is
 * a template over values read from offer and property rows. A value the row
 * does not hold is said as exactly that; nothing here can state a price, a
 * term or a facility that no row gave.
 * ---------------------------------------------------------------------- */

const nightsText = (n: number) => `${n} night${n === 1 ? '' : 's'}`;
const fromText = (from: DistanceFrom, label: string | null) =>
  from === 'search_centre' ? 'the middle of the results' : (label ?? (from === 'place' ? 'the place you named' : 'the place you searched'));
const km = (v: number) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
const starsText = (n: number) => `${n} star${n === 1 ? '' : 's'}`;
const count = (n: number) => n.toLocaleString('en');

export function formatDeadline(iso: string): string {
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
  return `${when} UTC`;
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What a row was silent about, in the user's terms. */
function notHeldLine(name: string, ask: FactAsk): string {
  switch (ask.fact) {
    case 'price':
      return `No price is held for ${name} on these dates.`;
    case 'cancellation':
      return `The listing for ${name} does not say whether it can be cancelled.`;
    case 'breakfast':
      return `The listing for ${name} does not say which meals are included.`;
    case 'rating':
      return `The listing for ${name} does not give a guest rating.`;
    case 'stars':
      return `The listing for ${name} does not give a star category.`;
    case 'room':
      return `The listing for ${name} does not name the room.`;
    case 'distance':
      return `The listing for ${name} does not give its position, so there is no distance.`;
    case 'facility':
      return `The listing for ${name} does not say whether it has ${MUST_HAVE_LABEL[ask.amenity]}.`;
  }
}

const RANKING_HEAD: Record<Superlative, string> = {
  cheapest: 'Cheapest',
  priciest: 'Most expensive',
  closest: 'Closest',
  furthest: 'Furthest',
  best_rated: 'Best rated',
  most_reviews: 'Most reviews',
  most_stars: 'Most stars',
};

const RANKING_MISSING: Record<Superlative, string> = {
  cheapest: 'no price',
  priciest: 'no price',
  closest: 'no position',
  furthest: 'no position',
  best_rated: 'no guest rating',
  most_reviews: 'no review count',
  most_stars: 'no star category',
};

function rankValueText(v: RankValue, currency: string): string {
  switch (v.on) {
    case 'price':
      return `${formatMoney(v.totalMinor, currency)} for ${nightsText(v.nights)}`;
    case 'distance':
      return `${km(v.km)} from ${fromText(v.from, v.label)}`;
    case 'rating':
      return v.reviews === null ? `rated ${v.rating}` : `rated ${v.rating} from ${count(v.reviews)} reviews`;
    case 'reviews':
      return `${count(v.reviews)} reviews`;
    case 'stars':
      return starsText(v.stars);
  }
}

function searchLine(field: SearchField, s: Extract<Answer, { kind: 'search' }>['search'], currency: string): string {
  const dates = `${formatDates(s.checkIn, s.checkOut)}.`;
  const guests = `${formatGuests(s.adults, s.childrenAges, s.rooms)}.`;
  const place = `Searching ${s.destinationText}.`;
  const cap = s.priceCapMinor === null ? null : `Capped at ${formatMoney(s.priceCapMinor, currency)} a night.`;
  const musts = s.mustHaves.length === 0 ? null : `Must have ${listNames(s.mustHaves.map((m) => MUST_HAVE_LABEL[m]))}.`;
  const order = s.priorities === null ? null : prioritiesLine(s.priorities, s.nearLabel);
  switch (field) {
    case 'dates':
      return dates;
    case 'guests':
      return guests;
    case 'destination':
      return place;
    case 'budget':
      return cap ?? 'No price cap is set.';
    case 'must_haves':
      return musts ?? 'Nothing is required of the hotel yet.';
    case 'priority':
      return order ?? 'No order is set.';
    case 'everything':
      return [place, dates, guests, cap, musts, order].filter(Boolean).join(' ');
  }
}

/** The words for an answer. Every number and term in it came from a row. */
export function answerLine(a: Answer, currency: string): string {
  switch (a.kind) {
    case 'price': {
      const extra = a.payAtPropertyMinor > 0 ? `, plus ${formatMoney(a.payAtPropertyMinor, currency)} paid at the hotel` : '';
      return `${a.name}: ${formatMoney(a.totalMinor, currency)} for ${nightsText(a.nights)}, ${formatMoney(a.perNightMinor, currency)} a night${extra}.`;
    }
    case 'cancellation':
      if (!a.refundable) return `${a.name}: non-refundable at this price.`;
      return a.until === null
        ? `${a.name}: refundable, but the listing does not give the deadline.`
        : `${a.name}: free cancellation until ${formatDeadline(a.until)}.`;
    case 'breakfast':
      return a.included ? `${a.name}: breakfast is included (${a.boardName}).` : `${a.name}: breakfast is not included; the rate is ${a.boardName}.`;
    case 'rating':
      return a.reviews === null ? `${a.name}: rated ${a.rating}; the listing gives no review count.` : `${a.name}: rated ${a.rating} from ${count(a.reviews)} reviews.`;
    case 'stars':
      return `${a.name}: ${starsText(a.stars)}.`;
    case 'room':
      return `${a.name}: the price is for ${a.roomName}.`;
    case 'distance':
      return `${a.name}: ${km(a.km)} from ${fromText(a.from, a.label)}.`;
    case 'facility':
      // "Lists", not "has": this is the supplier's facility list, and its silence is not a no.
      return a.listed ? `${a.name} lists ${MUST_HAVE_LABEL[a.amenity]}.` : `${a.name} does not list ${MUST_HAVE_LABEL[a.amenity]}.`;
    case 'not_held':
      return notHeldLine(a.name, a.ask);
    case 'across': {
      const [yes, no] =
        a.ask.fact === 'facility'
          ? [`Listing ${MUST_HAVE_LABEL[a.ask.amenity]}`, 'Not listing it']
          : a.ask.fact === 'breakfast'
            ? ['Breakfast included', 'Not included']
            : ['Refundable', 'Non-refundable'];
      const parts: string[] = [];
      if (a.yes.length > 0) parts.push(`${yes}: ${listNames(a.yes)}.`);
      if (a.no.length > 0) parts.push(`${no}: ${listNames(a.no)}.`);
      if (a.unknown.length > 0) parts.push(`The listing does not say for ${listNames(a.unknown)}.`);
      return parts.join(' ');
    }
    case 'ranking': {
      const tied = a.winners.length > 1 ? ', tied' : '';
      const missing = a.missing > 0 ? ` ${a.missing} ${a.missing === 1 ? 'has' : 'have'} ${RANKING_MISSING[a.superlative]} listed.` : '';
      return `${RANKING_HEAD[a.superlative]} of the ${a.of} listed${tied}: ${listNames(a.winners)}, ${rankValueText(a.value, currency)}.${missing}`;
    }
    case 'ranking_not_held':
      return `None of the ${a.of} listed has ${RANKING_MISSING[a.superlative].replace(/^no /, 'a ')} in its listing.`;
    case 'search':
      return searchLine(a.field, a.search, currency);
  }
}

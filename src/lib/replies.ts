import type { MustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { canonicalPriorities, type PriorityKey } from '@/lib/finder/rank';
import { centreLabel, placeName } from '@/lib/finder/searchPlan';
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
  | { kind: 'ok'; shortlisted: number; eligible: number; rejected: Record<string, number>; uncheckable: number; amenityFactsMissing: boolean }
  | { kind: 'no_availability' | 'needs_place' | 'needs_nationality' | 'not_found' }
  | { kind: 'supplier_error'; error: { retryable: boolean } };

export function outcomeLine(outcome: OutcomeForReply | null): string {
  if (!outcome) return '';
  switch (outcome.kind) {
    case 'ok': {
      const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
      if (outcome.eligible > 0) return `${outcome.eligible} of ${considered} hotels fit.`;
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
      return `None of ${considered} hotels fit${why.length ? `: ${why.join(', ')}` : ''}.`;
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
  agent_unavailable: 'The assistant did not answer, so nothing was changed. Send that again.',
  agent_misconfigured: 'The assistant is set up wrongly on this server (its API key was refused), so nothing was changed. Sending again will not help.',
  agent_not_configured: 'That needs the assistant, and ANTHROPIC_API_KEY is not set on this server, so nothing was changed.',
  ai_budget: 'This search has used its allowance for typed requests today. The buttons and filters still work.',
  which_place: 'Which city or area?',
} as const;

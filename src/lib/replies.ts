import type { MustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import type { PriorityKey } from '@/lib/finder/rank';
import type { Action } from '@/lib/store/actions';
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

export const PRIORITY_LINE: Record<PriorityKey, string> = {
  cheapest: 'Lowest price first.',
  closest: 'Closest first.',
  nicest: 'Best rated first.',
  basic: 'Cheapest well-reviewed first.',
};

const REJECTION_LINE: Record<Rejection, string> = {
  dates_in_past: 'Those dates are in the past.',
  checkout_not_after_checkin: 'Check-out has to be after check-in.',
  stay_too_long: 'Stays are limited to 30 nights.',
  more_rooms_than_adults: 'Each room needs at least one adult.',
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

function actionLine(action: Action, state: SearchState, currency: string): string {
  switch (action.type) {
    case 'set_priority':
      return PRIORITY_LINE[action.priority];
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
} as const;

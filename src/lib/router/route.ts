import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { PRIORITY_KEYS, type PriorityKey } from '@/lib/finder/rank';
import type { Action } from '@/lib/store/actions';
import type { SearchState } from '@/lib/store/reduce';
import type { Intent, Tier } from './catalogue';
import { addDays, extractGuests, extractNightsShift, extractPriceCap, extractTarget } from './slots';

/**
 * Turn Jev's label choices plus the message into typed actions, or defer.
 * Pure: readings in, a decision out. The asymmetry that does not move:
 *
 *  - the router may let a message through or act on it; it can never refuse a
 *    user or count a strike (a T2/T3 reading defers, it does not block);
 *  - it never books: `book` only opens the offer, and money still needs the
 *    rate re-check and the payment form;
 *  - anything it is not sure of goes to the agent.
 */

export type ChoiceReading<L extends string> = { choice: L; top: number; margin: number };

export type Readings = {
  tier: ChoiceReading<Tier> | null;
  intent: ChoiceReading<Intent> | null;
  /** Probability the message holds more than one request. */
  multiIntent: number | null;
  amenity: ChoiceReading<string> | null;
  /** Probability the user is dropping the requirement rather than adding it. */
  removing: number | null;
  priority: ChoiceReading<string> | null;
};

export const SETTLE = { top: 0.85, margin: 0.2, multiIntentMax: 0.3, noulYes: 0.8, noulNo: 0.2 };

export function settles(r: { top: number; margin: number } | null, min = SETTLE.top): boolean {
  return r !== null && r.top >= min && r.margin >= SETTLE.margin;
}

export type DeferReason =
  | 'no_reading'
  | 'tier_unsettled'
  | 'not_about_search'
  | 'multi_intent'
  | 'intent_unsettled'
  | 'intent_for_agent'
  | 'slot_missing'
  | 'slot_ambiguous'
  | 'currency_mismatch';

export type UiHint = { open: { propertyId: string; offerId: string | null } } | { book: { propertyId: string; offerId: string | null } };

export type RouteDecision =
  | { kind: 'actions'; intent: Intent; actions: Action[] }
  | { kind: 'ui'; intent: Intent; hint: UiHint }
  | { kind: 'line'; intent: Intent; line: 'greeting' }
  | { kind: 'defer'; reason: DeferReason };

export type ShortlistRow = { propertyId: string; offerId: string | null; name: string };

export function routeMessage(input: {
  message: string;
  readings: Readings;
  state: SearchState;
  currency: string;
  shortlist: ShortlistRow[];
  settleMin?: number;
}): RouteDecision {
  const { message, readings, state, shortlist } = input;
  const min = input.settleMin ?? SETTLE.top;
  const defer = (reason: DeferReason): RouteDecision => ({ kind: 'defer', reason });

  if (!readings.tier || !readings.intent) return defer('no_reading');
  if (!settles(readings.tier, min)) return defer('tier_unsettled');
  // Jev may wave a message through. Saying no is the agent's job.
  if (readings.tier.choice !== 'T1') return defer('not_about_search');
  if (readings.multiIntent === null || readings.multiIntent > SETTLE.multiIntentMax) return defer('multi_intent');
  if (!settles(readings.intent, min)) return defer('intent_unsettled');

  const intent = readings.intent.choice;
  const names = shortlist.map((r) => r.name);
  const target = () => {
    const n = extractTarget(message, names);
    return n === null ? null : shortlist[n - 1];
  };

  switch (intent) {
    case 'greeting_or_thanks':
      return { kind: 'line', intent, line: 'greeting' };

    case 'priority': {
      if (!settles(readings.priority, min)) return defer('slot_ambiguous');
      const p = readings.priority!.choice;
      if (!(PRIORITY_KEYS as readonly string[]).includes(p)) return defer('slot_missing');
      return { kind: 'actions', intent, actions: [{ type: 'set_priority', priority: p as PriorityKey }] };
    }

    case 'price_cap': {
      const slot = extractPriceCap(message);
      if (!slot) return defer('slot_missing');
      if (slot.kind === 'remove') return { kind: 'actions', intent, actions: [{ type: 'set_price_cap', perNightMinor: null }] };
      // Never convert currencies: a cap in dollars on a euro search goes to the agent.
      if (slot.currency !== null && slot.currency !== input.currency) return defer('currency_mismatch');
      const nights = Math.max(1, nightsBetween(state.stay.checkIn, state.stay.checkOut));
      const perNight = slot.per === 'stay' ? Math.floor(slot.amount / nights) : slot.amount;
      if (perNight < 1) return defer('slot_ambiguous');
      return { kind: 'actions', intent, actions: [{ type: 'set_price_cap', perNightMinor: perNight * 100 }] };
    }

    case 'must_have': {
      if (!settles(readings.amenity, min)) return defer('slot_ambiguous');
      const key = readings.amenity!.choice;
      if (!isMustHave(key)) return defer('slot_missing');
      if (readings.removing === null) return defer('slot_ambiguous');
      if (readings.removing >= SETTLE.noulYes) return { kind: 'actions', intent, actions: [{ type: 'remove_must_have', mustHave: key }] };
      if (readings.removing <= SETTLE.noulNo) return { kind: 'actions', intent, actions: [{ type: 'add_must_have', mustHave: key }] };
      return defer('slot_ambiguous');
    }

    case 'guests': {
      const g = extractGuests(message);
      if (!g) return defer('slot_missing');
      const rooms = g.rooms ?? Math.min(state.stay.rooms, g.adults);
      return { kind: 'actions', intent, actions: [{ type: 'set_guests', adults: g.adults, childrenAges: g.childrenAges, rooms }] };
    }

    case 'dates_shift': {
      const shift = extractNightsShift(message);
      if (shift === null || shift === 0) return defer('slot_missing');
      return {
        kind: 'actions',
        intent,
        actions: [{ type: 'set_dates', checkIn: state.stay.checkIn, checkOut: addDays(state.stay.checkOut, shift) }],
      };
    }

    case 'exclude': {
      const row = target();
      if (!row) return defer('slot_missing');
      return { kind: 'actions', intent, actions: [{ type: 'exclude_property', propertyId: row.propertyId }] };
    }

    case 'more':
      if (shortlist.length === 0) return defer('slot_missing');
      return { kind: 'actions', intent, actions: [{ type: 'more_options', propertyIds: shortlist.map((r) => r.propertyId) }] };

    case 'open': {
      const row = target();
      if (!row) return defer('slot_missing');
      return { kind: 'ui', intent, hint: { open: { propertyId: row.propertyId, offerId: row.offerId } } };
    }

    case 'book': {
      const row = target();
      if (!row) return defer('slot_missing');
      return { kind: 'ui', intent, hint: { book: { propertyId: row.propertyId, offerId: row.offerId } } };
    }

    case 'new_search':
    case 'question':
    case 'none':
      return defer('intent_for_agent');
  }
}

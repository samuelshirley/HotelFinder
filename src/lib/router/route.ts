import { AMENITIES, isMustHave, type Amenity } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { PRIORITY_KEYS, type PriorityKey } from '@/lib/finder/rank';
import type { Action } from '@/lib/store/actions';
import type { SearchState } from '@/lib/store/reduce';
import { HOTEL_FACTS, SEARCH_FIELDS, SUPERLATIVES, type HotelFact, type Intent, type SearchField, type Superlative, type Tier } from './catalogue';
import { addDays, extractGuests, extractNightsShift, extractPriceCap, extractTarget } from './slots';

/**
 * Turn Jev's label choices plus the message into typed actions, or defer.
 * Pure: readings in, a decision out. The asymmetry that does not move:
 *
 *  - the router may let a message through or act on it; it can never refuse a
 *    user or count a strike (a T2/T3 reading defers, it does not block);
 *  - it never books: `book` only opens the offer, and money still needs the
 *    rate re-check and the payment form;
 *  - a question it answers (`ask_hotels`, `ask_search`) is answered from rows
 *    the server holds, never from the model's knowledge, and changes nothing;
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
  /** Which fact about a hotel is asked for. */
  fact: ChoiceReading<string> | null;
  /** Whether a hotel is singled out by rank ("the cheapest"), and on what. */
  superlative: ChoiceReading<string> | null;
  /** Which part of the search is asked about. */
  searchField: ChoiceReading<string> | null;
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
  | 'currency_mismatch'
  | 'answer_unavailable';

/** One fact to read off a hotel row. A facility always names which one. */
export type FactAsk = { fact: Exclude<HotelFact, 'facility'> } | { fact: 'facility'; amenity: Amenity };

/** Facts that make sense asked of every hotel at once ("do any of them have a pool?"). */
const ASKABLE_OF_ALL: readonly HotelFact[] = ['facility', 'breakfast', 'cancellation'];

/** The fact a ranking is itself about: "which is cheapest?" asks for nothing beyond the ranking. */
const RANKED_ON: Record<Superlative, HotelFact> = {
  cheapest: 'price',
  priciest: 'price',
  closest: 'distance',
  furthest: 'distance',
  best_rated: 'rating',
  most_reviews: 'rating',
  most_stars: 'stars',
};

/**
 * A question the server can answer from rows it already holds. The plan names
 * WHAT to read; `lib/answers.ts` reads it, and says so when the row is silent.
 */
export type AnswerPlan =
  | ({ about: 'hotel'; propertyId: string } & FactAsk)
  | ({ about: 'hotel_by_rank'; superlative: Superlative } & FactAsk)
  | ({ about: 'all' } & FactAsk)
  | { about: 'ranking'; superlative: Superlative }
  | { about: 'search'; field: SearchField };

export type UiHint = { open: { propertyId: string; offerId: string | null } } | { book: { propertyId: string; offerId: string | null } };

export type RouteDecision =
  | { kind: 'actions'; intent: Intent; actions: Action[] }
  | { kind: 'ui'; intent: Intent; hint: UiHint }
  | { kind: 'line'; intent: Intent; line: 'greeting' }
  | { kind: 'answer'; intent: Intent; plan: AnswerPlan }
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

    case 'ask_hotels': {
      if (shortlist.length === 0) return defer('slot_missing');
      // Both readings must be sure, including a sure "none": an unsure one could
      // answer the wrong question.
      if (!settles(readings.superlative, min) || !settles(readings.fact, min)) return defer('slot_ambiguous');
      const sup = readings.superlative!.choice;
      const fact = readings.fact!.choice;
      const ranked = (SUPERLATIVES as readonly string[]).includes(sup) ? (sup as Superlative) : null;
      if (ranked === null && sup !== 'none') return defer('slot_missing');

      let ask: FactAsk | null = null;
      if (fact === 'facility') {
        if (!settles(readings.amenity, min)) return defer('slot_ambiguous');
        const key = readings.amenity!.choice;
        // The two must-haves an offer answers are facts of their own.
        if (key === 'free_cancellation') ask = { fact: 'cancellation' };
        else if (key === 'breakfast_included') ask = { fact: 'breakfast' };
        else if ((AMENITIES as readonly string[]).includes(key)) ask = { fact: 'facility', amenity: key as Amenity };
        else return defer('slot_missing');
      } else if ((HOTEL_FACTS as readonly string[]).includes(fact)) {
        ask = { fact: fact as Exclude<HotelFact, 'facility'> };
      } else if (fact !== 'none') {
        return defer('slot_missing');
      }

      const row = target();
      if (ranked !== null) {
        // "Which is cheapest?": the ranking is the answer.
        if (ask === null || ask.fact === RANKED_ON[ranked]) return { kind: 'answer', intent, plan: { about: 'ranking', superlative: ranked } };
        // "Is breakfast included at the cheapest?" A hotel named as well makes two candidates.
        if (row) return defer('slot_ambiguous');
        return { kind: 'answer', intent, plan: { about: 'hotel_by_rank', superlative: ranked, ...ask } };
      }
      // A question about a hotel that no listing field answers ("is it quiet?").
      if (ask === null) return defer('intent_for_agent');
      if (row) return { kind: 'answer', intent, plan: { about: 'hotel', propertyId: row.propertyId, ...ask } };
      if (ASKABLE_OF_ALL.includes(ask.fact)) return { kind: 'answer', intent, plan: { about: 'all', ...ask } };
      return defer('slot_missing');
    }

    case 'ask_search': {
      // An unsure field still gets a true answer: the whole search.
      if (!settles(readings.searchField, min)) return { kind: 'answer', intent, plan: { about: 'search', field: 'everything' } };
      const field = readings.searchField!.choice;
      if (!(SEARCH_FIELDS as readonly string[]).includes(field)) return defer('intent_for_agent');
      return { kind: 'answer', intent, plan: { about: 'search', field: field as SearchField } };
    }

    case 'new_search':
    case 'question':
    case 'none':
      return defer('intent_for_agent');
  }
}

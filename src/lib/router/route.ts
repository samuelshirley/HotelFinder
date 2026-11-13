import { AMENITIES, isMustHave, type Amenity } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import type { PriorityKey } from '@/lib/finder/rank';
import type { Action } from '@/lib/store/actions';
import type { SearchState } from '@/lib/store/reduce';
import { HOTEL_FACTS, SEARCH_FIELDS, SUPERLATIVES, type HotelFact, type Intent, type SearchField, type Superlative, type Tier } from './catalogue';
import { addDays, extractGuests, extractNightsShift, extractPriceCap, extractTarget, wantsMapHidden } from './slots';

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
  /** One probability per priority: is it something the user says they want? */
  wantsPrice: number | null;
  wantsQuality: number | null;
  wantsLocation: number | null;
  /** A specific place to be close to: needs a place lookup, so the agent handles it. */
  namesPlace: number | null;
  /** Which fact about a hotel is asked for. */
  fact: ChoiceReading<string> | null;
  /** Whether a hotel is singled out by rank ("the cheapest"), and on what. */
  superlative: ChoiceReading<string> | null;
  /** Which part of the search is asked about. */
  searchField: ChoiceReading<string> | null;
};

/**
 * "also", "too", "as well": add to the current set instead of replacing it.
 * A word check, not a Jev question: measured live on 2026-11-11, a yes/no
 * question for this read 0.33-0.76 on messages that said nothing of the sort.
 */
export function addsToCurrent(message: string): boolean {
  return /\b(also|too|as well|and also|plus)\b/i.test(message);
}

/** A noul read decisively, or null when Jev is unsure either way. */
function decided(p: number | null): boolean | null {
  if (p === null) return null;
  if (p >= SETTLE.noulYes) return true;
  if (p <= SETTLE.noulNo) return false;
  return null;
}

export const SETTLE = {
  top: 0.85,
  margin: 0.2,
  multiIntentMax: 0.3,
  noulYes: 0.8,
  noulNo: 0.2,
  /** The intent's floor when its own detail question independently agrees. */
  corroboratedTop: 0.6,
  /** The margin floor for an intent that only answers a question and changes nothing. */
  answerMargin: 0.1,
};

export function settles(r: { top: number; margin: number } | null, min = SETTLE.top): boolean {
  return r !== null && r.top >= min && r.margin >= SETTLE.margin;
}

/**
 * Two questions agreeing is stronger evidence than one question alone.
 *
 * The first live run (2026-11-11) deferred four messages Jev had right. Each
 * time the intent was the top label but under 0.85 (0.61 to 0.84), while the
 * detail question only that intent uses was at 0.95 or more: "just show me the
 * cheapest" had priority=cheapest at 1.0 (now wants_price at 0.97). So an intent below the usual bar
 * still settles when (a) it is the top label by a clear margin and (b) its own
 * detail question settles at the FULL bar on a real label, not `none`.
 *
 * Only for intents where a wrong settle is cheap:
 *  - `ask_hotels`, `ask_search` change nothing, so they need the smaller margin;
 *  - `priority` is one visible, undoable re-rank, so it keeps the full margin.
 * `must_have` is deliberately absent: its detail question (the amenity) is the
 * same one a question about a hotel uses, so it corroborates neither, and
 * reading "does it take dogs?" as a requirement would change the search.
 */
function corroborated(readings: Readings, min: number): boolean {
  const intent = readings.intent;
  if (!intent || intent.top < SETTLE.corroboratedTop) return false;
  const real = (r: ChoiceReading<string> | null) => settles(r, min) && r!.choice !== 'none';
  switch (intent.choice) {
    case 'priority':
      // Its detail questions are the yes/no wants: at least one a clear yes.
      return intent.margin >= SETTLE.margin && [readings.wantsPrice, readings.wantsQuality, readings.wantsLocation].some((w) => decided(w) === true);
    case 'ask_hotels':
      return intent.margin >= SETTLE.answerMargin && (real(readings.fact) || real(readings.superlative));
    case 'ask_search':
      return intent.margin >= SETTLE.answerMargin && real(readings.searchField);
    default:
      return false;
  }
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

export type UiHint =
  | { open: { propertyId: string; offerId: string | null } }
  | { book: { propertyId: string; offerId: string | null } }
  /** The map band shown or folded away. */
  | { map: 'show' | 'hide' }
  /** One listed hotel marked on the map (and the map shown). */
  | { focus: { propertyId: string } };

export type RouteDecision =
  | { kind: 'actions'; intent: Intent; actions: Action[] }
  | { kind: 'ui'; intent: Intent; hint: UiHint }
  | { kind: 'line'; intent: Intent; line: 'greeting' }
  | { kind: 'answer'; intent: Intent; plan: AnswerPlan }
  /** "I want to stay on East Manor": be close to a named place. The place is looked up in code (server/nearInWords.ts). */
  | { kind: 'near'; intent: Intent }
  | { kind: 'defer'; reason: DeferReason };

export type ShortlistRow = { propertyId: string; offerId: string | null; name: string };

/** Intents a named place never turns into "be close to it". */
const NOT_NEAR: readonly string[] = ['ask_hotels', 'ask_search', 'question', 'open', 'book', 'map', 'exclude', 'new_search', 'greeting_or_thanks'];

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
  // Wanting to be somewhere AND naming the place is the intent, whatever the intent
  // label says (Sam's "i wanna stay on east manor" read as must_have at 0.23, with
  // wants_location 0.87 and names_place 0.86). Questions and actions on a listed
  // hotel are excluded: "is the Westin close to the airport?" changes nothing.
  if (decided(readings.wantsLocation) === true && decided(readings.namesPlace) === true && !NOT_NEAR.includes(readings.intent.choice)) {
    return { kind: 'near', intent: readings.intent.choice };
  }
  if (!settles(readings.intent, min) && !corroborated(readings, min)) return defer('intent_unsettled');

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
      // A named place needs a lookup the router cannot do: the agent resolves it.
      const place = decided(readings.namesPlace);
      if (place !== false) return defer(place ? 'intent_for_agent' : 'slot_ambiguous');
      const wants: Array<[PriorityKey, boolean | null]> = [
        ['cheapest', decided(readings.wantsPrice)],
        ['nicest', decided(readings.wantsQuality)],
        ['closest', decided(readings.wantsLocation)],
      ];
      // Every one read decisively, or the agent decides: a half-read set is not a set.
      if (wants.some(([, w]) => w === null)) return defer('slot_ambiguous');
      const picked = wants.filter(([, w]) => w).map(([k]) => k);
      if (picked.length === 0) return defer('slot_missing');
      const priorities = addsToCurrent(message) ? [...new Set([...(state.priorities ?? []), ...picked])] : picked;
      return { kind: 'actions', intent, actions: [{ type: 'set_priorities', priorities }] };
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

    case 'map': {
      // "Where is the second one?" marks it; anything else shows or hides the map.
      const row = target();
      if (row) return { kind: 'ui', intent, hint: { focus: { propertyId: row.propertyId } } };
      return { kind: 'ui', intent, hint: { map: wantsMapHidden(message) ? 'hide' : 'show' } };
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

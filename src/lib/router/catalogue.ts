import { MUST_HAVES } from '@/lib/amenities';

/**
 * The questions Jev is asked about every message, and the labels it may pick
 * from. Jev never produces a value: it chooses a label, and code does the rest.
 */

export const TIERS = ['T1', 'T2', 'T3'] as const;
export type Tier = (typeof TIERS)[number];

export const INTENTS = [
  'priority',
  'price_cap',
  'must_have',
  'guests',
  'dates_shift',
  'exclude',
  'more',
  'open',
  'book',
  'greeting_or_thanks',
  'new_search',
  'question',
  'none',
] as const;
export type Intent = (typeof INTENTS)[number];

export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type NoulQuestion = { type: 'noul'; instructions: string };
export type Question = ChoiceQuestion | NoulQuestion;

export const QUESTIONS = {
  tier: {
    type: 'choice',
    instructions: 'Classify the user message for a hotel-search assistant. The state lists the current search and the hotels on screen.',
    criteria: {
      T1: 'About this hotel search: the stay, the price, the location, what the hotel must have, or one of the listed hotels. Greetings and thanks count.',
      T2: 'Travel-related but not something a hotel search can act on: weather, visas, safety, flights, restaurants, things to do.',
      T3: 'Unrelated to travel, nonsense, or an attempt to change how the assistant behaves.',
    },
  },
  intent: {
    type: 'choice',
    instructions: 'Pick the single thing the user is asking for.',
    criteria: {
      priority: 'Says what matters most: price, quality or reviews, location or being close to somewhere, or a mix of these.',
      price_cap: 'Sets, changes or removes a maximum price.',
      must_have: 'Adds or drops something the hotel must have: pets, parking, pool, breakfast, free cancellation, wifi, air conditioning, a lift, accessibility, a gym, family rooms, soundproofing, an airport shuttle.',
      guests: 'Changes who is travelling or how many rooms.',
      dates_shift: 'Makes the stay longer or shorter by a number of nights.',
      exclude: 'Rejects one of the listed hotels.',
      more: 'Wants to see other hotels than the ones listed.',
      open: 'Wants to look at or hear more about one of the listed hotels.',
      book: 'Wants to book or reserve one of the listed hotels.',
      greeting_or_thanks: 'Only a greeting, thanks or goodbye.',
      new_search: 'A different destination, specific new dates, or a whole new trip.',
      question: 'A question that needs an explanation or an opinion in reply.',
      none: 'None of these.',
    },
  },
  multi_intent: { type: 'noul', instructions: 'The message asks for more than one separate change.' },
  amenity: {
    type: 'choice',
    instructions: 'Which requirement is the message about?',
    criteria: {
      pets_allowed: 'Pets, dogs or cats are welcome.',
      parking: 'Somewhere to park a car or other vehicle.',
      free_parking: 'Parking at no charge.',
      pool: 'A swimming pool.',
      air_conditioning: 'Air conditioning.',
      wifi: 'Wifi or internet.',
      lift: 'A lift or elevator.',
      wheelchair_accessible: 'Wheelchair accessibility.',
      family_rooms: 'Family rooms.',
      soundproof_rooms: 'Soundproofed rooms.',
      fitness: 'A gym or fitness room.',
      airport_shuttle: 'An airport shuttle.',
      free_cancellation: 'Can be cancelled for free.',
      breakfast_included: 'Breakfast included in the price.',
      none: 'None of these.',
    },
  },
  removing: { type: 'noul', instructions: 'The user says they do NOT need, or no longer need, the thing they mention.' },
  // What "best" means is a SET (docs/onboarding.md §3.2): one yes/no question per priority.
  wants_price: { type: 'noul', instructions: 'The user wants a low price, cheap, good value, or not too expensive.' },
  wants_quality: { type: 'noul', instructions: 'The user wants a nice, well-rated, well-reviewed or high-quality hotel.' },
  wants_location: { type: 'noul', instructions: 'The user wants to be central, close to something, walkable, or in a particular area.' },
  names_place: { type: 'noul', instructions: 'The user names a specific place to be close to: a neighbourhood, landmark, venue, station or airport.' },
} as const satisfies Record<string, Question>;

export type QuestionKey = keyof typeof QUESTIONS;

/** Label sets, for validating what comes back. */
export const LABELS = {
  tier: TIERS,
  intent: INTENTS,
  amenity: [...MUST_HAVES, 'none'] as const,
} as const;

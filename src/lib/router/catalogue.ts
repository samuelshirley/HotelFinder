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
  'map',
  'greeting_or_thanks',
  'ask_hotels',
  'ask_search',
  'new_search',
  'question',
  'none',
] as const;
export type Intent = (typeof INTENTS)[number];

/** What the listing holds about a hotel, so a question about it can be answered from the row. */
export const HOTEL_FACTS = ['price', 'cancellation', 'breakfast', 'rating', 'stars', 'room', 'distance', 'facility'] as const;
export type HotelFact = (typeof HOTEL_FACTS)[number];

/** A hotel singled out by its rank among the ones on screen. Code finds the winner. */
export const SUPERLATIVES = ['cheapest', 'priciest', 'closest', 'furthest', 'best_rated', 'most_reviews', 'most_stars'] as const;
export type Superlative = (typeof SUPERLATIVES)[number];

export const SEARCH_FIELDS = ['dates', 'guests', 'destination', 'budget', 'must_haves', 'priority', 'everything'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

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
      priority: 'Says what matters most, or how to order the hotels: cheapest, closest or most central, nicest or best rated, or a mix of these.',
      price_cap: 'Sets, changes or removes a maximum price.',
      must_have: 'Adds or drops something the hotel must have: pets, parking, pool, breakfast, free cancellation, wifi, air conditioning, a lift, accessibility, a gym, family rooms, soundproofing, an airport shuttle.',
      guests: 'Changes who is travelling or how many rooms.',
      dates_shift: 'Makes the stay longer or shorter by a number of nights.',
      exclude: 'Rejects one of the listed hotels.',
      more: 'Wants to see other hotels than the ones listed.',
      open: 'Wants to look at or hear more about one of the listed hotels in general, without asking for one particular fact.',
      book: 'Wants to book or reserve one of the listed hotels.',
      map: 'Wants the map itself shown or hidden, or wants to see where one of the listed hotels is on the map. Changes nothing about the search.',
      greeting_or_thanks: 'Only a greeting, thanks or goodbye.',
      ask_hotels:
        'Asks for a fact the listing holds about the listed hotels, one of them or all of them: the price, what is paid at the hotel, cancellation, breakfast, the room, the guest rating, the stars, the distance, whether it has a facility such as parking or a pool, or which of them is cheapest, closest or best rated. Asking is not requiring: "does it have parking?" belongs here, "it needs parking" does not.',
      ask_search: 'Asks what the current search is set to: the dates, who is travelling, the destination, the price cap, the must-haves or the order. Changes nothing.',
      new_search: 'A different destination, specific new dates, or a whole new trip.',
      question:
        'Any other question: one that needs an explanation, an opinion or knowledge the listing does not hold, such as whether a hotel is quiet, nice or in a safe area.',
      none: 'None of these.',
    },
  },
  multi_intent: { type: 'noul', instructions: 'The message asks for more than one separate change.' },
  amenity: {
    type: 'choice',
    instructions: 'Which requirement or facility is the message about?',
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
  fact: {
    type: 'choice',
    instructions: 'Which fact about a listed hotel is the user asking for?',
    criteria: {
      price: 'What it costs: the total, the price per night, or what is paid at the hotel on top.',
      cancellation: 'Whether, or until when, the booking can be cancelled or refunded.',
      breakfast: 'Whether breakfast or other meals are included.',
      rating: 'The guest rating or the number of reviews.',
      stars: 'The star category.',
      room: 'Which room or bed type the price is for.',
      distance: 'How far it is from the centre or from the place searched.',
      facility:
        'Whether it has a facility: parking, a pool, wifi, air conditioning, a lift, a gym, an airport shuttle, family rooms, soundproofing, wheelchair access, or whether pets are allowed.',
      none: 'Something else, or not a question about a hotel.',
    },
  },
  superlative: {
    type: 'choice',
    instructions: 'Does the user single out a hotel by its rank among the listed hotels, and on what?',
    criteria: {
      cheapest: 'The one with the lowest price.',
      priciest: 'The one with the highest price.',
      closest: 'The one at the shortest distance.',
      furthest: 'The one at the longest distance.',
      best_rated: 'The one with the highest guest rating.',
      most_reviews: 'The one with the most reviews.',
      most_stars: 'The one with the highest star category.',
      none: 'No ranking among the listed hotels is mentioned.',
    },
  },
  search_field: {
    type: 'choice',
    instructions: 'Which part of the current search is the user asking about?',
    criteria: {
      dates: 'The check-in or check-out date, or the number of nights.',
      guests: 'Who is travelling: adults, children or rooms.',
      destination: 'Where the search is.',
      budget: 'The price cap.',
      must_haves: 'What the hotel is required to have.',
      priority: 'What the hotels are ordered by.',
      everything: 'The whole search, or several parts of it.',
      none: 'Not a question about the search settings.',
    },
  },
} as const satisfies Record<string, Question>;

export type QuestionKey = keyof typeof QUESTIONS;

/** Label sets, for validating what comes back. */
export const LABELS = {
  tier: TIERS,
  intent: INTENTS,
  amenity: [...MUST_HAVES, 'none'] as const,
  fact: [...HOTEL_FACTS, 'none'] as const,
  superlative: [...SUPERLATIVES, 'none'] as const,
  search_field: [...SEARCH_FIELDS, 'none'] as const,
} as const;

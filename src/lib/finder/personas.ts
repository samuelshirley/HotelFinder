import type { MustHave } from '@/lib/amenities';
import type { LatLng } from './geo';
import type { PriorityKey } from './rank';

/**
 * Twenty-seven travellers with different ideas of "best". They are the oracle for
 * the ranking (personas.test.ts) and, later, the scripts for simulated users
 * who talk to the chat (`says` is how each would open).
 *
 * "Best" is relative: there is no single golden list. Each persona is judged
 * against what THEY asked for.
 */
export type Persona = {
  id: string;
  who: string;
  says: string;
  /** What "best" means to them: a set. [] = they did not say. */
  priorities: PriorityKey[];
  mustHaves: MustHave[];
  capPerNightMinor: number | null;
  /** A place they named to be close to. null = the destination's own point. */
  near: LatLng | null;
  nearLabel: string | null;
  /** Which recorded search they are judged on. */
  search: 'city' | 'airport';
  audience: 'public' | 'member';
};

/** Praça da Ribeira, on the river. */
export const RIBEIRA: LatLng = { latitude: 41.1408, longitude: -8.613 };

const p = (persona: Partial<Persona> & Pick<Persona, 'id' | 'who' | 'says'>): Persona => ({
  priorities: [],
  mustHaves: [],
  capPerNightMinor: null,
  near: null,
  nearLabel: null,
  search: 'city',
  audience: 'member',
  ...persona,
});

export const PERSONAS: Persona[] = [
  p({ id: 'backpacker', who: 'Student on a rail pass', says: 'cheapest place in Porto for two nights, 11 to 13 December', priorities: ['cheapest'] }),
  p({ id: 'dog-owner', who: 'Travels with a border collie', says: 'two nights in Porto with my dog, as cheap as possible', priorities: ['cheapest'], mustHaves: ['pets_allowed'] }),
  p({ id: 'pickup-driver', who: 'Driving a pickup truck down from Galicia', says: 'need parking for a pickup, otherwise the cheapest', priorities: ['cheapest'], mustHaves: ['parking'] }),
  p({ id: 'plans-may-change', who: 'Waiting on a work schedule', says: 'cheapest I can still cancel for free', priorities: ['cheapest'], mustHaves: ['free_cancellation'] }),
  p({ id: 'honeymooners', who: 'Couple on their honeymoon', says: 'the nicest hotel in Porto, price is not the point', priorities: ['nicest'] }),
  p({ id: 'family-pool', who: 'Two adults, two children', says: 'somewhere with a pool and family rooms, keep it cheap', priorities: ['cheapest'], mustHaves: ['pool', 'family_rooms'] }),
  p({ id: 'riverside-worker', who: 'In town for meetings by the river', says: 'closest to Ribeira with wifi', priorities: ['closest'], mustHaves: ['wifi'], near: RIBEIRA, nearLabel: 'Ribeira' }),
  p({ id: 'light-sleeper', who: 'Sleeps badly in noisy rooms', says: 'just a decent bed, but the rooms must be soundproofed', priorities: ['cheapest', 'nicest'], mustHaves: ['soundproof_rooms'] }),
  p({ id: 'tight-budget-driver', who: 'On a fixed budget, arriving by car', says: 'under 70 a night with parking', priorities: ['cheapest'], mustHaves: ['parking'], capPerNightMinor: 7000 }),
  p({ id: 'impossible-budget', who: 'Hopes for a miracle', says: 'under 40 a night', priorities: ['cheapest'], capPerNightMinor: 4000 }),
  p({ id: 'breakfast-first', who: 'Will not start a day without breakfast', says: 'cheapest with breakfast included', priorities: ['cheapest'], mustHaves: ['breakfast_included'] }),
  p({ id: 'luxury-dog-owner', who: 'Spares no expense, dog comes too', says: 'the best hotel that takes dogs and has a pool', priorities: ['nicest'], mustHaves: ['pets_allowed', 'pool'] }),
  p({ id: 'anonymous-browser', who: 'Has not signed in', says: 'cheapest hotel in Porto', priorities: ['cheapest'], audience: 'public' }),
  p({ id: 'wheelchair-user', who: 'Uses a wheelchair', says: 'a safe, simple place that is wheelchair accessible with a lift', priorities: ['cheapest', 'nicest'], mustHaves: ['wheelchair_accessible', 'lift'] }),
  p({ id: 'gym-goer', who: 'Trains every morning', says: 'best rated with a gym under 120 a night', priorities: ['nicest'], mustHaves: ['fitness'], capPerNightMinor: 12000 }),
  p({ id: 'undecided', who: 'Has not said what matters', says: 'a hotel in Porto, 11 to 13 December' }),
  p({ id: 'summer-driver', who: 'Hates heat, drives, plans loosely', says: 'air con, parking and free cancellation, cheapest', priorities: ['cheapest'], mustHaves: ['air_conditioning', 'parking', 'free_cancellation'] }),
  p({ id: 'late-flight', who: 'Lands late, leaves early', says: 'central with an airport shuttle', priorities: ['closest'], mustHaves: ['airport_shuttle'] }),
  p({ id: 'dog-car-breakfast', who: 'Dog, car and an appetite', says: 'takes dogs, has parking, breakfast included, cheapest', priorities: ['cheapest'], mustHaves: ['pets_allowed', 'parking', 'breakfast_included'] }),
  p({ id: 'dog-and-flexible', who: 'Dog owner who may cancel', says: 'dog friendly and free cancellation', priorities: ['cheapest'], mustHaves: ['pets_allowed', 'free_cancellation'] }),
  // Several priorities at once (docs/onboarding.md §5): judged by the combined oracle.
  p({ id: 'close-and-nice', who: 'Weekend away, wants it lovely and walkable', says: 'somewhere close to Ribeira and really nice', priorities: ['closest', 'nicest'], near: RIBEIRA, nearLabel: 'Ribeira' }),
  p({ id: 'close-and-nice-reversed', who: 'The same, said the other way round', says: 'really nice, and close to Ribeira', priorities: ['nicest', 'closest'], near: RIBEIRA, nearLabel: 'Ribeira' }),
  p({ id: 'cheap-and-close', who: 'Short work trip by the river', says: 'cheap, near Ribeira', priorities: ['cheapest', 'closest'], near: RIBEIRA, nearLabel: 'Ribeira' }),
  p({ id: 'nice-not-crazy', who: 'Wants nice without paying for it', says: 'nice but not crazy expensive', priorities: ['nicest', 'cheapest'] }),
  p({ id: 'all-three', who: 'Wants everything', says: 'cheap, close to Ribeira and well reviewed', priorities: ['cheapest', 'closest', 'nicest'], near: RIBEIRA, nearLabel: 'Ribeira' }),
  p({ id: 'dog-nice-value', who: 'Couple and their dog', says: 'with my wife and the dog, nice but not crazy expensive', priorities: ['nicest', 'cheapest'], mustHaves: ['pets_allowed'] }),
  p({ id: 'airport-cheap', who: 'Early flight out of Porto', says: 'somewhere cheap near Porto airport', priorities: ['cheapest', 'closest'], search: 'airport' }),
];

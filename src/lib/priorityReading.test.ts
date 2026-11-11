import { describe, expect, it } from 'vitest';

import type { Readings } from '@/lib/router/route';
import { readingFromJev, validatePriorityReading } from './priorityReading';

const readings = (w: [number | null, number | null, number | null, number | null]): Readings => ({
  tier: null, intent: null, multiIntent: null, amenity: null, removing: null,
  wantsPrice: w[0], wantsQuality: w[1], wantsLocation: w[2], namesPlace: w[3], fact: null, superlative: null, searchField: null,
});

describe('Jev settles a typed answer only when every yes/no is decisive', () => {
  it('a clear set, canonical order', () => {
    expect(readingFromJev(readings([0.95, 0.9, 0.05, 0.02]))).toEqual({ priorities: ['cheapest', 'nicest'], nearQuery: null, nearQueryLocal: null });
  });
  it('one unsure answer, a named place, all no, or no reading: Haiku reads it', () => {
    expect(readingFromJev(readings([0.95, 0.5, 0.05, 0.02]))).toBeNull();
    expect(readingFromJev(readings([0.95, 0.1, 0.9, 0.9]))).toBeNull();
    expect(readingFromJev(readings([0.95, 0.1, 0.1, 0.5]))).toBeNull();
    expect(readingFromJev(readings([0.1, 0.1, 0.1, 0.02]))).toBeNull();
    expect(readingFromJev(readings([0.95, null, 0.1, 0.02]))).toBeNull();
    expect(readingFromJev(null)).toBeNull();
  });
});

describe('what Haiku returns is checked', () => {
  it('keeps known keys in canonical order; a named place implies close', () => {
    expect(validatePriorityReading({ priorities: ['nicest', 'cheapest'], near_place: null, near_place_local: null, no_preference: false })).toEqual({ priorities: ['cheapest', 'nicest'], nearQuery: null, nearQueryLocal: null });
    expect(validatePriorityReading({ priorities: ['cheapest'], near_place: ' Old  Town ', near_place_local: 'Vieille Ville', no_preference: false })).toEqual({ priorities: ['cheapest', 'closest'], nearQuery: 'Old Town', nearQueryLocal: 'Vieille Ville' });
  });
  it('drops what is not a key, and markup in a place', () => {
    expect(validatePriorityReading({ priorities: ['luxury', 'basic', 'closest'], near_place: '<b>x</b>Ribeira', near_place_local: null, no_preference: false })).toEqual({ priorities: ['closest'], nearQuery: 'b x /b Ribeira', nearQueryLocal: null });
    expect(validatePriorityReading({ priorities: ['closest'], near_place: 'x'.repeat(200), near_place_local: null, no_preference: false })).toEqual({ priorities: ['closest'], nearQuery: null, nearQueryLocal: null });
  });
  it('nothing usable is null (ask again); "anything is fine" is no preference', () => {
    expect(validatePriorityReading({ priorities: [], near_place: null, near_place_local: null, no_preference: false })).toBeNull();
    expect(validatePriorityReading({ priorities: [], near_place: null, near_place_local: null, no_preference: true })).toEqual({ priorities: [], nearQuery: null, nearQueryLocal: null });
    expect(validatePriorityReading('nonsense')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { NO_FILTERS } from '@/lib/filters';
import { describeChange, nearLabel, outcomeLine, SIGHTS_NAMED, type OutcomeForReply } from './replies';
import type { Applied, SearchState } from '@/lib/store/reduce';

const place = (n: number) => ({ placeId: `p${n}`, name: `Museum ${n}`, latitude: 41.15 + n / 1000, longitude: -8.61, rating: 4.5, reviewCount: 1000 - n });
const MUSEUMS = { kind: 'museums' as const, places: [1, 2, 3, 4, 5, 6, 7, 8].map(place) };

const state = (nights: number, sights: SearchState['stay']['sights'] = null): SearchState => ({
  priorities: ['cheapest'],
  guestNationality: 'ES',
  currency: 'EUR',
  stay: {
    destinationText: 'Porto, Portugal', placeId: 'place-porto', destPoint: null, destKind: 'area', destCountry: 'PT', near: null, sights,
    checkIn: '2026-12-11', checkOut: `2026-12-${11 + nights}`, adults: 2, childrenAges: [], rooms: 1, priceCapMinor: null, mustHaves: [], filters: NO_FILTERS, excludedPropertyIds: [],
  },
});
const fits = (eligible: number, over = 0, nearMisses = 0): OutcomeForReply => ({ kind: 'ok', shortlisted: Math.min(5, eligible), nearMisses, eligible, rejected: over ? { over_price_cap: over } : {}, uncheckable: 0, amenityFactsMissing: false });

describe('what a change says', () => {
  it('the change, not a count of the hotels that fit: the list shows them (Sam, 2026-11-13)', () => {
    const cap: Applied[] = [{ ok: true, action: { type: 'set_price_cap', perNightMinor: 12000 } }];
    expect(describeChange(cap, state(2), 'EUR', fits(18, 2))).toBe('Capped at €120 a night.');
    expect(outcomeLine(fits(18, 2))).toBe('');
  });

  it('too few fit: the misses listed under them are still said', () => {
    const cap: Applied[] = [{ ok: true, action: { type: 'set_price_cap', perNightMinor: 7000 } }];
    expect(describeChange(cap, state(2), 'EUR', fits(1, 19, 4))).toBe('Capped at €70 a night. Under it, the 4 closest misses are listed, each saying what it misses.');
  });

  it('none fit: why, as before', () => {
    const cap: Applied[] = [{ ok: true, action: { type: 'set_price_cap', perNightMinor: 1000 } }];
    expect(describeChange(cap, state(2), 'EUR', fits(0, 20))).toBe('Capped at €10 a night. None of 20 hotels fit: 20 are over the price cap.');
  });

  it('a change with no words of its own is never silent: the count is said after all', () => {
    const nationality: Applied[] = [{ ok: true, action: { type: 'set_nationality', code: 'FR' } }];
    expect(describeChange(nationality, state(2), 'EUR', fits(19, 11))).toBe('19 of 30 hotels fit.');
    // Nothing applied: nothing to say about the hotels.
    expect(describeChange([{ ok: false, action: { type: 'set_nationality', code: 'ES' }, rejection: 'no_change' }], state(2), 'EUR', null)).toBe('That is already how the search is set.');
  });
});

describe('sights in a line', () => {
  const set: Applied[] = [{ ok: true, action: { type: 'set_sights', sights: MUSEUMS } }];

  it('names the best known, counts the rest, and says where the ranking came from', () => {
    expect(SIGHTS_NAMED).toBe(4);
    expect(describeChange(set, state(4, MUSEUMS), 'EUR', fits(20))).toBe(
      'The most popular museums in Porto, by Google reviews: Museum 1, Museum 2, Museum 3 and Museum 4, and 4 more. A plan for each day is above the hotels.',
    );
  });

  it('only the ones the nights have time for: one night has three, and none is left to count', () => {
    expect(describeChange(set, state(1, MUSEUMS), 'EUR', fits(20))).toBe('The most popular museums in Porto, by Google reviews: Museum 1, Museum 2 and Museum 3. A plan for each day is above the hotels.');
    expect(describeChange(set, state(2, MUSEUMS), 'EUR', fits(20))).toContain('Museum 3 and Museum 4. A plan');
  });

  it('Spanish, and galleries', () => {
    const galleries = { ...MUSEUMS, kind: 'galleries' as const };
    expect(describeChange([{ ok: true, action: { type: 'set_sights', sights: galleries } }], state(1, galleries), 'EUR', fits(20), 'es')).toBe(
      'Las galerías de arte más populares de Porto, según las reseñas de Google: Museum 1, Museum 2 y Museum 3. Encima de los hoteles tienes un plan para cada día.',
    );
  });

  it('"close" is the sights while they are set, in the user\'s language, whatever label is stored', () => {
    const stay = { destinationText: 'Porto, Portugal', destKind: 'area' as const, near: { label: 'the museums' }, sights: { kind: 'museums' as const } };
    expect(nearLabel(stay)).toBe('the museums');
    expect(nearLabel(stay, 'es')).toBe('los museos');
    expect(nearLabel({ ...stay, sights: null, near: null })).toBe('central Porto');
  });

  it('dropping them says where "close" is again', () => {
    expect(describeChange([{ ok: true, action: { type: 'clear_sights' } }], state(2), 'EUR', fits(20))).toBe('Close to central Porto again.');
  });
});

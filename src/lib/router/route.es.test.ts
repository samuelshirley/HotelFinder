import { NO_FILTERS } from '@/lib/filters';
import { describe, expect, it } from 'vitest';

import type { SearchState } from '@/lib/store/reduce';
import type { Intent } from './catalogue';
import { routeMessage, type Readings, type ShortlistRow } from './route';

/**
 * Spanish messages through the router, with Jev's readings given (as in
 * route.test.ts). What this pins is the code half: once Jev has picked a
 * label, the values come out of Spanish words the same as out of English.
 * Whether Jev picks the right labels for Spanish is measured live, not here
 * (scripts/jev-live.sh has Spanish cases; not yet run).
 */

const P = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const shortlist: ShortlistRow[] = [
  { propertyId: P(1), offerId: 'o1', name: 'YOTEL Porto' },
  { propertyId: P(2), offerId: 'o2', name: 'Porto Palácio Hotel by The Editory' },
  { propertyId: P(3), offerId: 'o3', name: 'Hotel Carris Porto Ribeira' },
];
const state: SearchState = {
  priorities: ['cheapest'],
  guestNationality: 'ES',
  currency: 'EUR',
  stay: {
    destinationText: 'Oporto',
    placeId: 'place-porto', destPoint: null, destKind: null, destCountry: null, near: null, sights: null,
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
    adults: 2,
    childrenAges: [],
    rooms: 1,
    priceCapMinor: null,
    mustHaves: [],
    excludedPropertyIds: [],
    filters: NO_FILTERS,
  },
};
const sure = <L extends string>(choice: L) => ({ choice, top: 0.97, margin: 0.9 });
const readings = (intent: Intent, over: Partial<Readings> = {}): Readings => ({
  tier: sure('T1'),
  intent: sure(intent),
  multiIntent: 0.02,
  amenity: sure('none'),
  removing: 0.03,
  wantsPrice: 0.02,
  wantsQuality: 0.02,
  wantsLocation: 0.02,
  namesPlace: 0.02,
  fact: sure('none'),
  superlative: sure('none'),
  searchField: sure('none'),
  ...over,
});
const route = (message: string, r: Readings) => routeMessage({ message, readings: r, state, currency: 'EUR', shortlist });

describe('Spanish messages become the same typed actions', () => {
  it('a price cap per night, and one for the whole stay', () => {
    expect(route('menos de 120 por noche', readings('price_cap'))).toMatchObject({ actions: [{ type: 'set_price_cap', perNightMinor: 12000 }] });
    expect(route('no más de 301 en total', readings('price_cap'))).toMatchObject({ actions: [{ type: 'set_price_cap', perNightMinor: 15000 }] });
    expect(route('el precio me da igual', readings('price_cap'))).toMatchObject({ actions: [{ type: 'set_price_cap', perNightMinor: null }] });
  });

  it('a cap in another currency is never converted', () => {
    expect(route('menos de 120 dólares', readings('price_cap'))).toEqual({ kind: 'defer', reason: 'currency_mismatch' });
  });

  it('the party, children with their ages', () => {
    expect(route('dos adultos y un niño de 5', readings('guests'))).toMatchObject({ actions: [{ type: 'set_guests', adults: 2, childrenAges: [5], rooms: 1 }] });
    expect(route('somos cuatro, dos habitaciones', readings('guests'))).toMatchObject({ actions: [{ type: 'set_guests', adults: 4, childrenAges: [], rooms: 2 }] });
  });

  it('a night more or less', () => {
    expect(route('una noche más', readings('dates_shift'))).toMatchObject({ actions: [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-14' }] });
    expect(route('una noche menos', readings('dates_shift'))).toMatchObject({ actions: [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-12' }] });
  });

  it('a hotel by position or by name', () => {
    expect(route('quita el segundo', readings('exclude'))).toMatchObject({ actions: [{ type: 'exclude_property', propertyId: P(2) }] });
    expect(route('fuera el carris', readings('exclude'))).toMatchObject({ actions: [{ type: 'exclude_property', propertyId: P(3) }] });
    expect(route('reserva el primero', readings('book'))).toEqual({ kind: 'ui', intent: 'book', hint: { book: { propertyId: P(1), offerId: 'o1' } } });
  });

  it('the map', () => {
    expect(route('muestra el mapa', readings('map'))).toEqual({ kind: 'ui', intent: 'map', hint: { map: 'show' } });
    expect(route('oculta el mapa', readings('map'))).toEqual({ kind: 'ui', intent: 'map', hint: { map: 'hide' } });
    expect(route('¿dónde está el tercero en el mapa?', readings('map'))).toEqual({ kind: 'ui', intent: 'map', hint: { focus: { propertyId: P(3) } } });
  });

  it('"también" adds a priority to the current set', () => {
    expect(route('y también bien valorado', readings('priority', { wantsQuality: 0.95 }))).toMatchObject({ actions: [{ type: 'set_priorities', priorities: ['cheapest', 'nicest'] }] });
    expect(route('mejor bien valorado', readings('priority', { wantsQuality: 0.95 }))).toMatchObject({ actions: [{ type: 'set_priorities', priorities: ['nicest'] }] });
  });

  it('with no value in the words, it defers instead of guessing', () => {
    expect(route('algo más barato', readings('price_cap'))).toEqual({ kind: 'defer', reason: 'slot_missing' });
    expect(route('ese no', readings('exclude'))).toEqual({ kind: 'defer', reason: 'slot_missing' });
    expect(route('vamos con los niños', readings('guests'))).toEqual({ kind: 'defer', reason: 'slot_missing' });
    expect(route('un poco más', readings('dates_shift'))).toEqual({ kind: 'defer', reason: 'slot_missing' });
  });
});

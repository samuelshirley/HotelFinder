import { describe, expect, it } from 'vitest';

import { isPlainNo, isPlainYes } from '@/lib/stagedPlan';
import { addsToCurrent } from './route';
import { extractGuests, extractMinRating, extractMinStars, extractNightsShift, extractPriceCap, extractPropertyTypes, extractTarget, wantsMapHidden, wantsWholeList } from './slots';

/**
 * The same extractors, read in Spanish (docs/i18n.md). Each case mirrors an
 * English one in slots.test.ts; the "does not guess" cases matter as much:
 * null sends the message to the agent, a wrong value changes the search.
 */

describe('price cap, in Spanish', () => {
  it.each([
    ['menos de 120 por noche', { kind: 'cap', amount: 120, per: 'night', currency: null }],
    ['¿puede ser más barato, por debajo de 120 €?', { kind: 'cap', amount: 120, per: 'night', currency: 'EUR' }],
    ['máximo 90 euros la noche', { kind: 'cap', amount: 90, per: 'night', currency: 'EUR' }],
    ['no más de 300 en total', { kind: 'cap', amount: 300, per: 'stay', currency: null }],
    ['presupuesto de 200 dólares', { kind: 'cap', amount: 200, per: 'night', currency: 'USD' }],
    ['hasta 150/noche', { kind: 'cap', amount: 150, per: 'night', currency: null }],
    ['como mucho 80 libras', { kind: 'cap', amount: 80, per: 'night', currency: 'GBP' }],
    ['el precio me da igual', { kind: 'remove' }],
    ['quita el límite de precio', { kind: 'remove' }],
    ['sin límite', { kind: 'remove' }],
  ])('%s', (message, expected) => {
    expect(extractPriceCap(message)).toEqual(expected);
  });

  it.each([
    'algo más barato, por favor',
    'entre 80 y 120 por noche',
    'menos de 120 por noche o 300 en total',
    'la habitación 204 estaba bien',
    'menos de 100 euros o 110 dólares',
    'menos de 120 por noche en total',
    'llegamos el 12/12',
  ])('does not guess: %s', (message) => {
    expect(extractPriceCap(message)).toBeNull();
  });
});

describe('which hotel, in Spanish', () => {
  const names = ['YOTEL Porto', 'Porto Palácio Hotel by The Editory', 'Mercure Porto Centro Santa Catarina', 'Hotel Carris Porto Ribeira', 'NEYA Porto Hotel'];
  it.each([
    ['el segundo', 2],
    ['háblame de la opción 3', 3],
    ['la cuarta tiene buena pinta', 4],
    ['reserva el primero', 1],
    ['el último', 5],
    ['el número dos, por favor', 2],
    ['la 3ª', 3],
    ['¿qué tal el yotel?', 1],
    ['¿el Carris está bien?', 4],
    ['quita el palacio', 2],
  ])('%s → %i', (message, n) => {
    expect(extractTarget(message, names)).toBe(n);
  });

  it.each(['ese', 'el primero o el segundo', 'el sexto', 'la opción 9', 'el yotel o el neya', 'un cuarto doble'])('does not guess: %s', (message) => {
    expect(extractTarget(message, names)).toBeNull();
  });
});

describe('guests, in Spanish', () => {
  it.each([
    ['dos adultos y un niño de 5', { adults: 2, childrenAges: [5], rooms: null }],
    ['2 adultos y 2 niños de 4 y 9 años', { adults: 2, childrenAges: [4, 9], rooms: null }],
    ['somos cuatro', { adults: 4, childrenAges: [], rooms: null }],
    ['seis personas, tres habitaciones', { adults: 6, childrenAges: [], rooms: 3 }],
    ['solo yo', { adults: 1, childrenAges: [], rooms: null }],
    ['viajo sola', { adults: 1, childrenAges: [], rooms: null }],
    ['mi mujer y yo', { adults: 2, childrenAges: [], rooms: null }],
    ['solo somos dos', { adults: 2, childrenAges: [], rooms: null }],
    ['tres adultos, sin niños', { adults: 3, childrenAges: [], rooms: null }],
    ['una adulta y una niña de 7', { adults: 1, childrenAges: [7], rooms: null }],
  ])('%s', (message, expected) => {
    expect(extractGuests(message)).toEqual(expected);
  });

  it.each(['dos adultos y dos niños', 'dos adultos y un niño de 5 y 9', 'dos habitaciones', 'una familia de cuatro', 'dos adultos y un niño de 19'])('does not guess: %s', (message) => {
    expect(extractGuests(message)).toBeNull();
  });
});

describe('nights, in Spanish', () => {
  it.each([
    ['una noche más', 1],
    ['dos noches más, por favor', 2],
    ['añade 2 noches', 2],
    ['alarga la estancia una noche', 1],
    ['una noche menos', -1],
    ['quita dos noches', -2],
  ])('%s → %i', (message, n) => {
    expect(extractNightsShift(message)).toBe(n);
  });

  it.each(['más noches', 'una noche más y dos noches menos', 'tres noches'])('does not guess: %s', (message) => {
    expect(extractNightsShift(message)).toBeNull();
  });
});

describe('the map, yes and no, and "also", in Spanish', () => {
  it('reads hiding and showing the map', () => {
    for (const m of ['oculta el mapa', 'quita el mapa', 'cierra el mapa', 'sin mapa', 'no quiero el mapa']) expect(wantsMapHidden(m), m).toBe(true);
    for (const m of ['muestra el mapa', 'enséñame el mapa', '¿dónde está en el mapa?']) expect(wantsMapHidden(m), m).toBe(false);
  });

  it('a plain yes or no to a staged question, and nothing more', () => {
    for (const m of ['Sí', 'vale', 'De acuerdo.', 'sí, por favor', 'adelante', 'claro']) expect(isPlainYes(m), m).toBe(true);
    for (const m of ['no gracias', 'mejor no', 'déjalo', 'cancela']) expect(isPlainNo(m), m).toBe(true);
    for (const m of ['sí, pero por menos de 100', 'vale, y con piscina']) expect(isPlainYes(m), m).toBe(false);
  });

  it('adds to the current priorities on "también" and "además"', () => {
    expect(addsToCurrent('y también bien valorado')).toBe(true);
    expect(addsToCurrent('además, céntrico')).toBe(true);
    expect(addsToCurrent('solo lo más barato')).toBe(false);
  });
});

describe('the filters and the full list, in Spanish', () => {
  it('a star class', () => {
    expect(extractMinStars('solo de 4 estrellas o más')).toBe(4);
    expect(extractMinStars('cinco estrellas')).toBe(5);
    expect(extractMinStars('3 o 4 estrellas')).toBeNull();
    expect(extractMinStars('algo bonito')).toBeNull();
  });

  it('a guest rating, not a star class, a night count or a price', () => {
    expect(extractMinRating('con una valoración de 8 o más')).toBe(8);
    expect(extractMinRating('nota de 8,5 para arriba')).toBe(8.5);
    expect(extractMinRating('4 estrellas y valoración de 9')).toBe(9);
    expect(extractMinRating('valorado, 3 noches')).toBeNull();
    expect(extractMinRating('menos de 8 euros')).toBeNull();
  });

  it('kinds of place, and none when one is refused', () => {
    expect(extractPropertyTypes('solo apartamentos')).toEqual(['apartment']);
    expect(extractPropertyTypes('un apartahotel o un albergue')).toEqual(['aparthotel', 'hostel']);
    expect(extractPropertyTypes('hoteles o casas rurales')).toEqual(['holiday_home', 'hotel']);
    expect(extractPropertyTypes('un hotel, sin apartamentos')).toBeNull();
  });

  it('the whole list, and not "the others"', () => {
    expect(wantsWholeList('enséñamelos todos')).toBe(true);
    expect(wantsWholeList('la lista completa')).toBe(true);
    expect(wantsWholeList('enséñame todos los demás')).toBe(false);
    expect(wantsWholeList('enséñame otros')).toBe(false);
  });
});

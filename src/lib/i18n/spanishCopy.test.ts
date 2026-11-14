import { NO_FILTERS } from '@/lib/filters';
import { describe, expect, it } from 'vitest';

import { errorCopy } from '@/lib/errors';
import { missText, reasonText } from '@/lib/reasonText';
import { answerLine, describeChange, filtersLine, fixedLine, formatDates, formatGuests, formatMoney, fullListLine, nearLabel, outcomeLine, prioritiesLabel, prioritiesLine, roomsShown, savedLine, savedListLine } from '@/lib/replies';
import type { SearchState } from '@/lib/store/reduce';

/**
 * The same templates in Spanish, said whole. The catalogue guard proves every
 * entry exists; this proves the lines they make read as Spanish, with the
 * values in the right places and the locale's own money and dates.
 */

const state: SearchState = {
  priorities: ['cheapest'],
  guestNationality: 'ES',
  currency: 'EUR',
  stay: {
    destinationText: 'Oporto, Portugal',
    placeId: 'p', destPoint: null, destKind: 'area', destCountry: 'PT', near: null, sights: null,
    checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2, childrenAges: [], rooms: 1, priceCapMinor: null, mustHaves: [], excludedPropertyIds: [], filters: NO_FILTERS,
  },
};

describe('Spanish lines', () => {
  it('money, dates and the party in the Spanish forms', () => {
    expect(formatMoney(12000, 'EUR', 'es')).toBe('120\u00a0€');
    expect(formatMoney(15855, 'EUR', 'es')).toBe('158,55\u00a0€');
    expect(formatDates('2026-12-11', '2026-12-13', 'es')).toBe('11–13 dic, 2 noches');
    expect(formatDates('2026-11-30', '2026-12-01', 'es')).toBe('30 nov–1 dic, 1 noche');
    expect(formatGuests(2, [5], 1, 'es')).toBe('2 adultos, 1 niño (5)');
    expect(formatGuests(1, [], 2, 'es')).toBe('1 adulto, 2 habitaciones');
  });

  it('what changed, and how many fit', () => {
    const results = [
      { ok: true as const, action: { type: 'set_price_cap' as const, perNightMinor: 12000 } },
      { ok: true as const, action: { type: 'add_must_have' as const, mustHave: 'parking' as const } },
    ];
    const outcome = { kind: 'ok' as const, shortlisted: 5, eligible: 7, rejected: { over_price_cap: 13 }, uncheckable: 0, amenityFactsMissing: false };
    expect(describeChange(results, state, 'EUR', outcome, 'es')).toBe('Con un máximo de 120\u00a0€ por noche. Imprescindible: aparcamiento.');
    expect(outcomeLine({ kind: 'ok', shortlisted: 0, eligible: 0, rejected: { over_price_cap: 4, excluded_by_user: 1 }, uncheckable: 0, amenityFactsMissing: false }, 'es')).toBe(
      'Ninguno de los 5 hoteles encaja: 4 superan el límite de precio, 1 los apartaste tú.',
    );
    expect(describeChange([{ ok: false, action: { type: 'set_price_cap', perNightMinor: 100 }, rejection: 'no_change' }], state, 'EUR', null, 'es')).toBe('La búsqueda ya está así.');
  });

  it('priorities, and where "close" is measured from', () => {
    expect(nearLabel(state.stay, 'es')).toBe('el centro de Oporto');
    expect(prioritiesLabel(['cheapest', 'closest'], 'el centro de Oporto', 'es')).toBe('Precio bajo · Cerca del centro de Oporto');
    expect(prioritiesLabel(['closest'], 'Ribeira', 'es')).toBe('Cerca de Ribeira');
    expect(prioritiesLine(['cheapest', 'nicest'], 'x', 'es')).toBe('Ordenado por precio bajo y buenas opiniones.');
    expect(prioritiesLine([], 'x', 'es')).toBe('Equilibrado: precio, valoración y distancia.');
  });

  it('answers from the rows, and the rows\' silence', () => {
    expect(answerLine({ kind: 'price', name: 'YOTEL Porto', totalMinor: 9910, nights: 2, perNightMinor: 4955, payAtPropertyMinor: 300 }, 'EUR', 'es')).toBe(
      'YOTEL Porto: 99,10\u00a0€ por 2 noches, 49,55\u00a0€ por noche, más 3\u00a0€ a pagar en el hotel.',
    );
    expect(answerLine({ kind: 'not_held', name: 'YOTEL Porto', ask: { fact: 'facility', amenity: 'pool' } }, 'EUR', 'es')).toBe('El anuncio de YOTEL Porto no dice si tiene piscina.');
    expect(answerLine({ kind: 'across', ask: { fact: 'breakfast' }, yes: ['A'], no: ['B', 'C'], unknown: ['D'] }, 'EUR', 'es')).toBe(
      'Desayuno incluido: A. Sin desayuno: B y C. El anuncio no lo dice para D.',
    );
    expect(answerLine({ kind: 'ranking', superlative: 'cheapest', winners: ['A'], value: { on: 'price', totalMinor: 9910, nights: 2 }, of: 5, missing: 1 }, 'EUR', 'es')).toBe(
      'El más barato de los 5 de la lista: A, 99,10\u00a0€ por 2 noches. 1 aparece sin precio.',
    );
  });

  it('the reasons on the cards', () => {
    const ctx = { currency: 'EUR', hasMustHaves: false, locale: 'es' as const };
    expect(reasonText({ kind: 'cheapest_meeting_all_musts' }, ctx)).toBe('El más barato disponible');
    expect(reasonText({ kind: 'closest', km: 1.4, to: 'search_centre' }, ctx)).toBe('El más cercano: a 1,4 km del centro de los resultados');
    expect(reasonText({ kind: 'best_mix', of: ['cheapest', 'nicest'], rating: 9.2, price_rank: 7, eligible: 20 }, ctx)).toBe('La mejor combinación de precio bajo y buenas opiniones: valorado con 9,2, el 7.º más barato de 20');
    expect(reasonText({ kind: 'runner_up', price_delta_minor: 989, km_delta: 0.4, rating_delta: -0.2 }, ctx)).toBe('Frente al primero: 9,89\u00a0€ más, 400 m más lejos, 0,2 menos de valoración');
    expect(missText([{ kind: 'missing_must_have', must: ['pool', 'parking'] }], 'EUR', 'es')).toBe('Le falta: sin piscina o aparcamiento');
  });

  it('fixed lines and errors', () => {
    expect(fixedLine('map_hidden', 'es')).toBe('El mapa está plegado. Di "muestra el mapa" para que vuelva.');
    expect(errorCopy('rate_limited', 'es')).toBe('Demasiadas peticiones en poco tiempo. Espera un minuto y continúa.');
    expect(errorCopy('never_heard_of_it', 'es')).toBe(errorCopy('server_error', 'es'));
  });

  it('the filters, the full list, saved hotels and the rooms', () => {
    expect(filtersLine({ minStars: 4, minRating: 8, propertyTypes: ['hotel', 'apartment'], chains: ['Mercure'] }, 'es')).toBe(
      'Se muestran solo 4 estrellas o más, valoración de 8 o más, hoteles o apartamentos, de Mercure.',
    );
    expect(describeChange([{ ok: true, action: { type: 'set_min_stars', stars: 4 } }], state, 'EUR', null, 'es')).toBe('Solo 4 estrellas o más.');
    expect(fullListLine(5, 30, 'es')).toBe('Los 35 hoteles que encajan aparecen debajo de los mejores, en el mismo orden.');
    expect(savedLine('YOTEL Porto', 'es')).toBe('YOTEL Porto está guardado. Tus hoteles guardados aparecen junto a tus viajes.');
    expect(savedListLine([], 'es')).toBe(fixedLine('saved_none', 'es'));
    expect(savedListLine(['A', 'B'], 'es')).toBe('Has guardado 2 hoteles: A y B. Aparecen junto a tus viajes.');
    expect(roomsShown(null, 'es')).toBe('Mejor precio');
    expect(formatGuests(4, [], null, 'es')).toBe('4 adultos');
    expect(missText([{ kind: 'below_stars', stars: 3 }, { kind: 'not_property_type', listed: 'hostel', wanted: ['hotel'] }], 'EUR', 'es')).toBe('Le falta: 3 estrellas; es un albergue');
    expect(missText([{ kind: 'out_of_town', km: 10.7, max_km: 8 }], 'EUR', 'es')).toBe('Le falta: fuera de la ciudad, a 10,7 km del centro de los resultados (una búsqueda por ciudad llega hasta 8,0 km)');
    expect(outcomeLine({ kind: 'ok', shortlisted: 0, eligible: 0, rejected: { filtered_out: 6 }, filterUnknown: 2, uncheckable: 0, amenityFactsMissing: false }, 'es')).toBe(
      'Ninguno de los 6 hoteles encaja: 6 no pasan un filtro (de 2 el anuncio no lo dice).',
    );
    expect(errorCopy('freeze_limit', 'es')).toBe('Ya tienes 3 habitaciones congeladas. Confirma o libera una de ellas primero.');
  });
});

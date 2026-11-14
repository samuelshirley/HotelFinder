import { describe, expect, it } from 'vitest';

import { normalizePlaces } from '@/server/supplier/liteapi/normalize';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { placesResponse } from '@/server/supplier/liteapi/schemas';
import { mentionsDates, pickPlace, isInsideTown, pickNearPlace, withEarlierPlace } from './placePick';

const recorded = (name: string) => normalizePlaces(placesResponse.parse(fixture(name)));
const pick = (q: string, name: string) => {
  const r = pickPlace(q, recorded(name));
  return r.kind === 'one' ? r.place.name : r.kind === 'ask' ? r.places.map((p) => p.name) : null;
};

describe('which place a typed destination means, on recorded place searches', () => {
  it('a city with a station of the same name, and no station word: the city', () => {
    expect(pick('Annecy, France', 'places-annecy')).toBe('Annecy');
    expect(pick('Porto, Portugal', 'places-porto')).toBe('Porto');
  });
  it('an airport named: the airport, never its bus stop or the airport hotel', () => {
    expect(pick('Barcelona airport', 'places-barcelona-airport')).toBe('Barcelona Airport (BCN)');
    // Two airports match "Porto airport"; only one carries both words.
    expect(pick('Porto airport', 'places-porto-airport')).toBe('Porto Airport (OPO)');
  });
  it('four towns called Lisbon: ask, and the airport is not one of the choices', () => {
    const r = pick('Lisbon', 'places-lisbon');
    expect(r).toEqual(['Lisbon', 'Lisbon', 'Lisbon', 'Lisbon']);
  });
  it('an airport code names the airport', () => {
    expect(pick('LIS', 'places-lisbon')).toBe('Lisbon Airport (LIS)');
  });
  it('only hotels found: nothing', () => {
    expect(pickPlace('old town, Annecy', recorded('places-old-town-annecy'))).toEqual({ kind: 'none' });
  });
});

describe('a place with where it is: "Madrid, España" (2026-11-14, recorded in Spanish)', () => {
  it('the city called Madrid that lies in España: not Plaza de España in Madrid, never the guesthouse', () => {
    // Before: "¿Cuál?" between Madrid and Plaza de España.
    expect(pick('Madrid, España', 'places-madrid-espana-es')).toBe('Madrid');
    expect(pickPlace('Madrid, España', recorded('places-madrid-espana-es'))).toMatchObject({ kind: 'one', place: { address: 'España' } });
  });
  it('accents do not matter, and the bare name still asks', () => {
    expect(pick('Madrid, Espana', 'places-madrid-espana-es')).toBe('Madrid');
    expect(pick('Madrid', 'places-madrid-es')).toEqual(['Madrid', 'Madrid', 'Madridejos', 'Madrid']);
  });
  it('the name must be the whole word: Madridejos, España is not "Madrid, España"', () => {
    expect(pickPlace('Madrid, España', recorded('places-madrid-es'))).toMatchObject({ kind: 'one', place: { name: 'Madrid', address: 'España' } });
  });
  it('a "where" that fits none, or several, still asks', () => {
    expect(pick('Madrid, Francia', 'places-madrid-es')).toEqual(['Madrid', 'Madrid', 'Madridejos', 'Madrid']);
    expect(pickPlace('Lisbon, USA', recorded('places-lisbon')).kind).toBe('ask');
  });
});

describe('the place retyped at "Where to?" keeps where the first message said it was', () => {
  it.each([
    ['Madrid', 'Madrid, España', 'Madrid, España'],
    ['madrid ', 'Madrid, España', 'madrid, España'],
    ['Madrid', 'Madrid (España)', 'Madrid, España'],
    // Not the same place, or nothing more was said, or the typed words say where themselves: as typed.
    ['Barcelona', 'Madrid, España', 'Barcelona'],
    ['Madrid', 'Madrid', 'Madrid'],
    ['Madrid', undefined, 'Madrid'],
    ['Madrid, Colombia', 'Madrid, España', 'Madrid, Colombia'],
    ['Plaza de España', 'Madrid, España', 'Plaza de España'],
  ])('%j after %j → %j', (typed, earlier, query) => {
    expect(withEarlierPlace(typed, earlier)).toBe(query);
  });
});

describe('does the text talk about when?', () => {
  it.each([
    ['Lisbon with my wife and the dog, 3 nights in March', true],
    ['cheap hotel near Barcelona airport next Friday for 2', true],
    ['Annecy, 1–6 Dec, just me', true],
    ['this weekend in Porto', true],
    ['Annecy, just me, central and well rated', false],
    ['Porto', false],
    ['a hotel for 2 adults with a pool', false],
  ])('%s → %s', (text, yes) => {
    expect(mentionsDates(text)).toBe(yes);
  });
});

describe('a place to be close to, inside the town being searched', () => {
  const p = (name: string, address: string | null, types: string[]) => ({ placeId: `id-${name}`, name, address, types });
  // Recorded live from the sandbox, 11 Nov 2026.
  const EAST_MANOR = [
    p('Manor Road', 'Austin, TX, USA', ['route', 'geocode']),
    p('Austin Peace Academy', 'Manor Road, Austin, TX, USA', ['primary_school', 'educational_institution', 'school']),
    p('Austin Achieve Public Schools - Manor Campus', 'Manor Road, Austin, TX, USA', ['point_of_interest', 'school', 'educational_institution']),
    p('Austin Pearls Pediatric Dentistry', 'Manor Road, Austin, TX, USA', ['point_of_interest', 'health', 'dentist']),
  ];
  const BARE_MANOR = [
    p('Austin Rifle Club', 'Littig Road, Manor, TX, USA', ['point_of_interest', 'establishment', 'sports_activity_location']),
    p('Red Roof Inn & Suites Austin East – Manor', 'U.S. 290, Manor, TX, USA', ['lodging', 'establishment', 'hotel']),
    p('Manor Road', 'Austin, TX, USA', ['route', 'geocode']),
    p('Manor Expressway', 'Austin, TX, USA', ['route', 'geocode']),
  ];

  it('the road, not the businesses on it', () => {
    expect(pickNearPlace('East Manor Road', EAST_MANOR)).toMatchObject({ kind: 'one', place: { name: 'Manor Road' } });
  });

  it('two roads called Manor: ask, and never offer a hotel', () => {
    const r = pickNearPlace('manor', BARE_MANOR);
    expect(r.kind).toBe('ask');
    expect(r.kind === 'ask' && r.places.map((x) => x.name)).toEqual(['Manor Road', 'Manor Expressway']);
  });

  it('a neighbourhood beats a business named after it', () => {
    const r = pickNearPlace('Ribeira', [
      p('Ribeira', 'Porto, Portugal', ['geocode', 'neighborhood', 'political']),
      p('Ribeira Square', 'Porto, Portugal', ['geocode', 'route']),
      p('Ribeira Vintage', 'Rua de Sousa Viterbo, Porto, Portugal', ['service', 'establishment', 'point_of_interest']),
    ]);
    expect(r).toMatchObject({ kind: 'ask' }); // two real places named Ribeira: the neighbourhood and the square
  });

  it('one real place is it, even when its name is not the words typed (never "Which one?" with one button)', () => {
    expect(pickNearPlace('the river', [p('Lady Bird Lake', 'Austin, TX, USA', ['natural_feature', 'geocode']), p('Riverside Bar', 'Austin, TX, USA', ['bar', 'point_of_interest'])])).toMatchObject({ kind: 'one', place: { name: 'Lady Bird Lake' } });
  });

  it('a town is never a place to be near; a hotel never is', () => {
    expect(pickNearPlace('Manor', [p('Manor', 'TX, USA', ['locality', 'political'])])).toEqual({ kind: 'none' });
    expect(pickNearPlace('old town', [p('Le Chalet in the heart of the old town', 'Annecy, France', ['establishment', 'point_of_interest', 'lodging'])])).toEqual({ kind: 'none' });
  });

  it('a venue named exactly, when no road or district matches', () => {
    expect(pickNearPlace('Moody Center', [p('Moody Center', 'Austin, TX, USA', ['stadium', 'point_of_interest', 'establishment']), p('Moody Theater', 'Austin, TX, USA', ['point_of_interest'])])).toMatchObject({ kind: 'one', place: { name: 'Moody Center' } });
  });

  it('inside the town or the town itself', () => {
    expect(isInsideTown(['route', 'geocode'])).toBe(true);
    expect(isInsideTown(['locality', 'political'])).toBe(false);
    expect(isInsideTown(['lodging', 'establishment'])).toBe(false);
  });
});

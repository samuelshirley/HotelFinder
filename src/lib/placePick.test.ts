import { describe, expect, it } from 'vitest';

import { normalizePlaces } from '@/server/supplier/liteapi/normalize';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { placesResponse } from '@/server/supplier/liteapi/schemas';
import { mentionsDates, pickPlace } from './placePick';

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

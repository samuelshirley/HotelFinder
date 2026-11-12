import { describe, expect, it } from 'vitest';

import { fixture } from '@/server/supplier/liteapi/fixtures';
import { centreLabel, destinationKind, MIN_HOTELS, planSearch, RADIUS_M, WIDE_RADIUS_M } from './searchPlan';

const types = (name: string) => (fixture(name) as unknown as { data: { types: string[] } }).data.types;
const PORTO = { latitude: 41.1579, longitude: -8.6291 };
const OPO = { latitude: 41.2481, longitude: -8.6814 };

describe('what kind of place a destination is, from the recorded place details', () => {
  it('a city or a neighbourhood is an area; an airport is a point', () => {
    expect(destinationKind(types('place-annecy'))).toBe('area');
    expect(destinationKind(types('place-porto'))).toBe('area');
    expect(destinationKind(types('place-vieille-ville-annecy'))).toBe('area');
    expect(destinationKind(types('place-barcelona-airport'))).toBe('point');
    expect(destinationKind(types('place-porto-airport'))).toBe('point');
    expect(destinationKind([])).toBe('area');
  });
});

describe('planning the search', () => {
  const area = { destinationText: 'Porto, Portugal', placeId: 'place:porto', destPoint: PORTO, destKind: 'area' as const, near: null };

  it('an area with nothing named: search the place, and measure from the middle of its hotels, not its map point', () => {
    // Porto's map point is ~2 km from its old centre; the middle of the recorded hotels is ~0.4 km (searchPlan.ts).
    expect(planSearch(area)).toEqual({ kind: 'place', where: { placeId: 'place:porto' }, target: null });
    expect(centreLabel('Annecy, France')).toBe('central Annecy');
  });

  it('an airport as the destination: a radius around it, widened once', () => {
    const plan = planSearch({ destinationText: 'Porto Airport (OPO)', placeId: 'place:opo', destPoint: OPO, destKind: 'point', near: null });
    expect(plan).toEqual({
      kind: 'radius',
      where: { ...OPO, radiusM: RADIUS_M },
      wider: { ...OPO, radiusM: WIDE_RADIUS_M },
      target: { point: OPO, label: 'Porto Airport (OPO)', from: 'destination' },
    });
    expect([RADIUS_M, WIDE_RADIUS_M, MIN_HOTELS]).toEqual([5000, 15000, 10]);
  });

  it('a place the user named wins over the destination, and is searched around', () => {
    const near = { label: 'Vieille Ville', latitude: 45.8992, longitude: 6.1294 };
    const plan = planSearch({ ...area, near });
    expect(plan).toMatchObject({ kind: 'radius', where: { latitude: 45.8992, longitude: 6.1294, radiusM: RADIUS_M }, target: { label: 'Vieille Ville', from: 'place' } });
  });

  it('no point known (the lookup failed): search the place, and the ranking falls back to the middle of the results', () => {
    expect(planSearch({ ...area, destPoint: null, destKind: null })).toEqual({ kind: 'place', where: { placeId: 'place:porto' }, target: null });
    expect(planSearch({ ...area, destPoint: null, destKind: null, placeId: null })).toBeNull();
  });
});

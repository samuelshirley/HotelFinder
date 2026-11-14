import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { haversineKm } from '@/lib/finder/geo';
import {
  MAX_SIGHTS,
  MIN_SIGHT_RATING,
  MIN_SIGHT_REVIEWS,
  SIGHTS_RADIUS_M,
  parsePlaces,
  pickSights,
  readStaySights,
  routeUrl,
  sightCount,
  sightMapsUrl,
  sightsCentre,
  sightsInPlay,
  walkingPlan,
  type Sight,
} from './sights';

// The recorded Google responses (scripts/capture-google-fixtures.mjs); never hand-written.
const recorded = (name: string): unknown => JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../server/sights/__fixtures__', `${name}.json`), 'utf8'));
type Raw = { id: string; displayName: { text: string }; rating?: number; userRatingCount?: number; primaryType?: string; businessStatus?: string };
const raw = (name: string) => (recorded(name) as { places: Raw[] }).places;

const PORTO = { latitude: 41.1579438, longitude: -8.629105299999999 };
const ANNECY = { latitude: 45.9058956, longitude: 6.1259117 };
const portoMuseums = () => parsePlaces(recorded('nearby-museums-porto'), 'museums');
// A hotel in Ribeira, by the river: a real point, not from any fixture.
const HOTEL = { latitude: 41.1408, longitude: -8.613 };

describe('reading Google\'s places', () => {
  it('keeps exactly what Google sent for each place', () => {
    const places = portoMuseums();
    const byId = new Map(raw('nearby-museums-porto').map((p) => [p.id, p]));
    expect(places.length).toBeGreaterThan(10);
    for (const p of places) {
      const source = byId.get(p.placeId)!;
      expect(p.name).toBe(source.displayName.text);
      expect(p.rating).toBe(source.rating);
      expect(p.reviewCount).toBe(source.userRatingCount);
    }
  });

  it('leaves out a place with no rating: there is nothing to call it popular on', () => {
    const unrated = raw('nearby-museums-annecy').filter((p) => p.rating === undefined);
    expect(unrated.length).toBeGreaterThan(0); // the recording holds one
    const kept = new Set(parsePlaces(recorded('nearby-museums-annecy'), 'museums').map((p) => p.placeId));
    for (const p of unrated) expect(kept.has(p.id)).toBe(false);
  });

  it('leaves out a place of another kind, and one that is closed', () => {
    // The museums recording read as galleries: no primary type matches.
    expect(parsePlaces(recorded('nearby-museums-porto'), 'galleries')).toEqual([]);
    const [first, ...rest] = raw('nearby-museums-porto');
    const closed = { places: [{ ...first, businessStatus: 'CLOSED_PERMANENTLY' }, ...rest] };
    expect(parsePlaces(closed, 'museums').some((p) => p.placeId === first.id)).toBe(false);
  });

  it('an error body, nonsense, or one broken place is no places, never a throw', () => {
    expect(parsePlaces(recorded('nearby-error-bad-type'), 'museums')).toEqual([]);
    expect(parsePlaces(null, 'museums')).toEqual([]);
    expect(parsePlaces({ places: 'no' }, 'museums')).toEqual([]);
    const [first, second] = raw('nearby-museums-porto');
    expect(parsePlaces({ places: [{ ...first, location: null }, second] }, 'museums').map((p) => p.placeId)).toEqual([second.id]);
  });
});

describe('the most popular', () => {
  it('Porto: the most reviewed first, judged against the raw recording', () => {
    const picked = pickSights(portoMuseums(), PORTO);
    // The oracle is written from Google's raw rows, not from pickSights' own filters.
    const oracle = raw('nearby-museums-porto')
      .filter((p) => (p.rating ?? 0) >= 4 && (p.userRatingCount ?? 0) >= 50)
      .sort((a, b) => b.userRatingCount! - a.userRatingCount!)
      .slice(0, 8)
      .map((p) => p.displayName.text);
    expect(picked.map((p) => p.name)).toEqual(oracle);
    expect(picked).toHaveLength(MAX_SIGHTS);
    expect(picked[0].name).toBe('FC Porto Museum');
    expect(picked.map((p) => p.name)).toContain('Serralves Museum of Contemporary Art');
  });

  it('never a place rated under 4.0 or with under 50 reviews, however few are left', () => {
    const picked = pickSights(parsePlaces(recorded('nearby-museums-annecy'), 'museums'), ANNECY);
    expect(picked.length).toBeGreaterThanOrEqual(2);
    for (const p of picked) {
      expect(p.rating).toBeGreaterThanOrEqual(MIN_SIGHT_RATING);
      expect(p.reviewCount).toBeGreaterThanOrEqual(MIN_SIGHT_REVIEWS);
    }
    // The recording holds a 5.0 from 3 reviews: a perfect score nobody has heard of is not popular.
    expect(raw('nearby-museums-annecy').some((p) => p.rating === 5 && (p.userRatingCount ?? 0) < 50)).toBe(true);
    expect(picked.some((p) => p.rating === 5)).toBe(false);
  });

  it('the most reviewed place in town is still left out when it is rated under 4.0', () => {
    // No recording holds a famous, poorly rated museum, so one recorded place is given that rating.
    const famousButPoor: Sight = { ...portoMuseums()[0], placeId: 'poor', rating: 3.9, reviewCount: 1_000_000 };
    const picked = pickSights([famousButPoor, ...portoMuseums()], PORTO);
    expect(picked.some((p) => p.placeId === 'poor')).toBe(false);
    expect(pickSights([{ ...famousButPoor, rating: 4 }, ...portoMuseums()], PORTO)[0].placeId).toBe('poor');
  });

  it('a high rating never outranks more reviews', () => {
    const picked = pickSights(portoMuseums(), PORTO);
    for (let i = 1; i < picked.length; i++) expect(picked[i - 1].reviewCount).toBeGreaterThanOrEqual(picked[i].reviewCount);
  });

  it('the order does not depend on the order Google sent', () => {
    const places = portoMuseums();
    expect(pickSights([...places].reverse(), PORTO)).toEqual(pickSights(places, PORTO));
  });

  it('a place outside the radius is not this town\'s', () => {
    const far: Sight = { ...portoMuseums()[0], placeId: 'far', latitude: PORTO.latitude + 1, reviewCount: 1_000_000 };
    expect(haversineKm(PORTO, far) * 1000).toBeGreaterThan(SIGHTS_RADIUS_M);
    expect(pickSights([far, ...portoMuseums()], PORTO).some((p) => p.placeId === 'far')).toBe(false);
  });
});

describe('how many a stay has time for', () => {
  it('two a day, at least three, at most eight', () => {
    expect([1, 2, 3, 4, 5, 30].map(sightCount)).toEqual([3, 4, 6, 8, 8, 8]);
  });

  it('a longer stay uses more of the same list, and the middle moves with it', () => {
    const sights = { kind: 'museums' as const, places: pickSights(portoMuseums(), PORTO) };
    expect(sightsInPlay(sights, 2)).toEqual(sights.places.slice(0, 4));
    expect(sightsInPlay(sights, 4)).toEqual(sights.places);
    expect(sightsCentre(sights, 2)).not.toEqual(sightsCentre(sights, 4));
    // The middle is inside the town, not out at the stadium or the park.
    expect(haversineKm(PORTO, sightsCentre(sights, 4)!)).toBeLessThan(3);
  });
});

describe('the day-by-day plan', () => {
  const sights = pickSights(portoMuseums(), PORTO);

  it('every sight is visited exactly once, over no more days than nights', () => {
    for (const nights of [1, 2, 3, 4, 7]) {
      const inPlay = sights.slice(0, sightCount(nights));
      const days = walkingPlan(HOTEL, inPlay, nights);
      expect(days.length).toBeLessThanOrEqual(nights);
      expect(days.map((d) => d.day)).toEqual(days.map((_, i) => i + 1));
      expect(days.flatMap((d) => d.stops.map((s) => s.placeId)).sort()).toEqual(inPlay.map((s) => s.placeId).sort());
      for (const d of days) expect(d.stops.length).toBeGreaterThan(0);
    }
  });

  it('four nights: four days of two', () => {
    expect(walkingPlan(HOTEL, sights, 4).map((d) => d.stops.length)).toEqual([2, 2, 2, 2]);
  });

  it('each leg is the straight line from the stop before, the first from the hotel', () => {
    for (const d of walkingPlan(HOTEL, sights, 4)) {
      let here: { latitude: number; longitude: number } = HOTEL;
      let total = 0;
      for (const stop of d.stops) {
        expect(stop.legKm).toBeCloseTo(haversineKm(here, stop), 1);
        total += stop.legKm;
        here = stop;
      }
      expect(d.totalKm).toBeCloseTo(total, 5);
    }
  });

  it('within a day the nearer stop comes first, and the shortest day is day one', () => {
    const days = walkingPlan(HOTEL, sights, 4);
    for (const d of days) expect(haversineKm(HOTEL, d.stops[0])).toBeLessThanOrEqual(Math.min(...d.stops.map((s) => haversineKm(HOTEL, s))) + 1e-9);
    for (let i = 1; i < days.length; i++) expect(days[i - 1].totalKm).toBeLessThanOrEqual(days[i].totalKm);
  });

  it('sights in the same direction share a day: the two at Serralves are never split', () => {
    const days = walkingPlan(HOTEL, sights, 4);
    const dayOf = (name: string) => days.find((d) => d.stops.some((s) => s.name === name))!.day;
    expect(dayOf('Serralves Museum of Contemporary Art')).toBe(dayOf('Casa de Serralves'));
  });

  it('the same plan whatever order the sights arrive in', () => {
    expect(walkingPlan(HOTEL, [...sights].reverse(), 4)).toEqual(walkingPlan(HOTEL, sights, 4));
  });

  it('no sights, no plan', () => {
    expect(walkingPlan(HOTEL, [], 4)).toEqual([]);
  });
});

describe('the Google Maps links', () => {
  const [a, b, c] = pickSights(portoMuseums(), PORTO);

  it('a sight opens by its place id', () => {
    const url = new URL(sightMapsUrl(a));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', query: a.name, query_place_id: a.placeId });
  });

  it('a day is walking directions from the hotel\'s point through each stop, in order', () => {
    const url = new URL(routeUrl(HOTEL, [a, b, c]));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: '1',
      origin: `${HOTEL.latitude},${HOTEL.longitude}`,
      waypoints: `${a.name}|${b.name}`,
      waypoint_place_ids: `${a.placeId}|${b.placeId}`,
      destination: c.name,
      destination_place_id: c.placeId,
      travelmode: 'walking',
    });
  });

  it('one stop needs no waypoints', () => {
    const q = new URL(routeUrl(HOTEL, [a])).searchParams;
    expect(q.has('waypoints')).toBe(false);
    expect(q.get('destination_place_id')).toBe(a.placeId);
  });

  it('every day of a plan carries its own route', () => {
    for (const d of walkingPlan(HOTEL, [a, b, c], 2)) expect(d.routeUrl).toBe(routeUrl(HOTEL, d.stops));
  });
});

describe('the stored value', () => {
  it('reads back what was stored, and anything else is no sights', () => {
    const stored = { kind: 'museums', places: pickSights(portoMuseums(), PORTO) };
    expect(readStaySights(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(readStaySights(null)).toBeNull();
    expect(readStaySights({ kind: 'beaches', places: stored.places })).toBeNull();
    expect(readStaySights({ kind: 'museums', places: [] })).toBeNull();
  });
});

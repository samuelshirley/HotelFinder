import { describe, expect, it } from 'vitest';

import { actionSchema, type ResolvedAction } from './actions';
import { fingerprint, NEAR_MAX_KM, reduce, reduceAll, type SearchState } from './reduce';
import { NO_FILTERS } from '@/lib/filters';

const TODAY = '2026-11-11';
const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';
const RIBEIRA = { placeId: 'place-ribeira', label: 'Ribeira', latitude: 41.1408, longitude: -8.613 };

const state = (over: Partial<SearchState['stay']> = {}, top: Partial<SearchState> = {}): SearchState => ({
  priorities: null,
  guestNationality: 'ES',
  currency: 'EUR',
  stay: {
    destinationText: 'Porto',
    placeId: 'place-porto',
    destPoint: { latitude: 41.1579, longitude: -8.6291 },
    destKind: 'area',
    destCountry: 'PT',
    near: null,
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
    adults: 2,
    childrenAges: [],
    rooms: 1,
    priceCapMinor: null,
    mustHaves: [],
    filters: NO_FILTERS,
    excludedPropertyIds: [],
    ...over,
  },
  ...top,
});

const ok = (s: SearchState, a: ResolvedAction) => {
  const r = reduce(s, a, TODAY);
  if (!r.ok) throw new Error(`rejected: ${r.rejection}`);
  return r;
};

describe('which changes need a new search and which only a re-rank', () => {
  it.each<[ResolvedAction, 'rerank' | 'refetch']>([
    [{ type: 'set_priorities', priorities: ['cheapest'] }, 'rerank'],
    [{ type: 'set_priorities', priorities: [] }, 'rerank'],
    [{ type: 'set_near', near: RIBEIRA }, 'refetch'],
    [{ type: 'set_price_cap', perNightMinor: 12000 }, 'rerank'],
    [{ type: 'add_must_have', mustHave: 'parking' }, 'rerank'],
    [{ type: 'exclude_property', propertyId: P1 }, 'rerank'],
    [{ type: 'more_options', propertyIds: [P1, P2] }, 'rerank'],
    [{ type: 'set_guests', adults: 4, childrenAges: [4, 9], rooms: 2 }, 'refetch'],
    [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-14' }, 'refetch'],
    [{ type: 'set_destination', placeId: 'place-lisbon', destinationText: 'Lisbon', point: null }, 'refetch'],
    [{ type: 'set_nationality', code: 'PT' }, 'refetch'],
    [{ type: 'set_currency', code: 'USD' }, 'refetch'],
  ])('%j → %s', (action, effect) => {
    expect(ok(state(), action).effect).toBe(effect);
  });
});

describe('reducers', () => {
  it('never mutate the state they are given', () => {
    const before = state({ mustHaves: ['pool'], excludedPropertyIds: [P1] });
    const frozen = JSON.stringify(before);
    ok(before, { type: 'add_must_have', mustHave: 'parking' });
    ok(before, { type: 'exclude_property', propertyId: P2 });
    ok(before, { type: 'set_guests', adults: 3, childrenAges: [], rooms: 1 });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('adds and removes a must-have once', () => {
    const added = ok(state(), { type: 'add_must_have', mustHave: 'parking' }).state;
    expect(added.stay.mustHaves).toEqual(['parking']);
    expect(reduce(added, { type: 'add_must_have', mustHave: 'parking' }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    expect(ok(added, { type: 'remove_must_have', mustHave: 'parking' }).state.stay.mustHaves).toEqual([]);
    expect(reduce(state(), { type: 'remove_must_have', mustHave: 'pool' }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
  });

  it('sets and clears the price cap', () => {
    const capped = ok(state(), { type: 'set_price_cap', perNightMinor: 9000 }).state;
    expect(capped.stay.priceCapMinor).toBe(9000);
    expect(ok(capped, { type: 'set_price_cap', perNightMinor: null }).state.stay.priceCapMinor).toBeNull();
  });

  it('refuses dates in the past, a check-out not after check-in, and a stay over 30 nights', () => {
    const dates = (checkIn: string, checkOut: string) => reduce(state(), { type: 'set_dates', checkIn, checkOut }, TODAY);
    expect(dates('2026-11-10', '2026-11-12')).toEqual({ ok: false, rejection: 'dates_in_past' });
    expect(dates('2026-12-13', '2026-12-13')).toEqual({ ok: false, rejection: 'checkout_not_after_checkin' });
    expect(dates('2026-12-13', '2026-12-11')).toEqual({ ok: false, rejection: 'checkout_not_after_checkin' });
    expect(dates('2026-12-01', '2027-01-05')).toEqual({ ok: false, rejection: 'stay_too_long' });
    expect(dates('2026-11-11', '2026-11-12').ok).toBe(true);
  });

  it('refuses more rooms than adults', () => {
    expect(reduce(state(), { type: 'set_guests', adults: 2, childrenAges: [], rooms: 3 }, TODAY)).toEqual({
      ok: false,
      rejection: 'more_rooms_than_adults',
    });
  });

  it('a new destination clears what was set aside for the old one', () => {
    const s = state({ excludedPropertyIds: [P1] });
    const next = ok(s, { type: 'set_destination', placeId: 'place-lisbon', destinationText: 'Lisbon', point: null }).state;
    expect(next.stay).toMatchObject({ placeId: 'place-lisbon', destinationText: 'Lisbon', excludedPropertyIds: [] });
  });

  it('a new destination takes its own point and kind, and forgets the old place to be near', () => {
    const s = ok(state(), { type: 'set_near', near: RIBEIRA }).state;
    const next = ok(s, {
      type: 'set_destination',
      placeId: 'place-bcn',
      destinationText: 'Barcelona Airport (BCN)',
      point: { placeId: 'place-bcn', label: 'Barcelona Airport (BCN)', latitude: 41.2983, longitude: 2.08, kind: 'point', country: 'ES' },
    }).state;
    expect(next.stay).toMatchObject({ destPoint: { latitude: 41.2983, longitude: 2.08 }, destKind: 'point', destCountry: 'ES', near: null });
  });

  it('priorities are a set: the same set in another order is no change, and [] means no preference', () => {
    const s = ok(state(), { type: 'set_priorities', priorities: ['closest', 'cheapest'] }).state;
    expect(s.priorities).toEqual(['cheapest', 'closest']);
    expect(reduce(s, { type: 'set_priorities', priorities: ['cheapest', 'closest'] }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    expect(ok(s, { type: 'set_priorities', priorities: [] }).state.priorities).toEqual([]);
    // Not asked yet (null) and "no preference" ([]) are different answers.
    expect(ok(state(), { type: 'set_priorities', priorities: [] }).state.priorities).toEqual([]);
  });

  it('a place to be near: set once, refused when it is another trip, and cleared back to the destination', () => {
    const s = ok(state(), { type: 'set_near', near: RIBEIRA }).state;
    expect(s.stay.near).toEqual(RIBEIRA);
    expect(reduce(s, { type: 'set_near', near: RIBEIRA }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    const lisbon = { placeId: 'place-baixa', label: 'Baixa', latitude: 38.7115, longitude: -9.1375 };
    expect(reduce(state(), { type: 'set_near', near: lisbon }, TODAY)).toEqual({ ok: false, rejection: 'near_too_far' });
    expect(NEAR_MAX_KM).toBe(50);
    const cleared = ok(s, { type: 'clear_near' });
    expect(cleared).toMatchObject({ effect: 'refetch', state: { stay: { near: null } } });
    expect(reduce(state(), { type: 'clear_near' }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    // With no destination point known there is nothing to measure "too far" from.
    expect(ok(state({ destPoint: null }), { type: 'set_near', near: lisbon }).state.stay.near).toEqual(lisbon);
  });

  it('"more options" sets aside what is on screen, without duplicates, and can be undone', () => {
    const one = ok(state({ excludedPropertyIds: [P1] }), { type: 'more_options', propertyIds: [P1, P2] }).state;
    expect(one.stay.excludedPropertyIds).toEqual([P1, P2]);
    expect(reduce(one, { type: 'more_options', propertyIds: [P1, P2] }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    expect(ok(one, { type: 'reset_exclusions' }).state.stay.excludedPropertyIds).toEqual([]);
  });

  it('applies several actions in order; a rejected one changes nothing and does not stop the rest', () => {
    const { state: after, effect, results } = reduceAll(
      state(),
      [
        { type: 'set_priorities', priorities: ['cheapest'] },
        { type: 'set_dates', checkIn: '2026-01-01', checkOut: '2026-01-02' },
        { type: 'add_must_have', mustHave: 'pool' },
      ],
      TODAY,
    );
    expect(after.priorities).toEqual(['cheapest']);
    expect(after.stay.mustHaves).toEqual(['pool']);
    expect(after.stay.checkIn).toBe('2026-12-11');
    expect(effect).toBe('rerank');
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(reduceAll(state(), [{ type: 'set_priorities', priorities: ['cheapest'] }, { type: 'set_nationality', code: 'PT' }], TODAY).effect).toBe('refetch');
    expect(reduceAll(state(), [], TODAY).effect).toBe('none');
  });

  it('the fingerprint changes with any change and ignores list order', () => {
    const a = state({ mustHaves: ['pool', 'parking'] });
    const b = state({ mustHaves: ['parking', 'pool'] });
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(ok(a, { type: 'set_price_cap', perNightMinor: 1 }).state)).not.toBe(fingerprint(a));
    expect(fingerprint(state({}, { priorities: ['nicest'] }))).not.toBe(fingerprint(state()));
    expect(fingerprint(state({}, { priorities: [] }))).not.toBe(fingerprint(state()));
    expect(fingerprint(state({}, { priorities: ['nicest', 'cheapest'] }))).toBe(fingerprint(state({}, { priorities: ['cheapest', 'nicest'] })));
    expect(fingerprint(state({ near: RIBEIRA }))).not.toBe(fingerprint(state()));
    // A change staged in euros must not be applied after the prices moved to dollars.
    expect(fingerprint(state({}, { currency: 'USD' }))).not.toBe(fingerprint(state()));
  });
});

describe('the currency prices are quoted in', () => {
  it('a new currency is a new search, and the same one is no change', () => {
    const r = ok(state(), { type: 'set_currency', code: 'USD' });
    expect(r.state.currency).toBe('USD');
    expect(r.effect).toBe('refetch');
    expect(reduce(state(), { type: 'set_currency', code: 'EUR' }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
  });

  it('drops a price cap, which was in the old currency: nothing is converted', () => {
    const r = ok(state({ priceCapMinor: 12000 }), { type: 'set_currency', code: 'GBP' });
    expect(r.state.stay.priceCapMinor).toBeNull();
    expect(r.state.stay).toEqual({ ...state().stay, priceCapMinor: null });
  });

  it('takes only a code the supplier prices in', () => {
    expect(actionSchema.safeParse({ type: 'set_currency', code: 'USD' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'set_currency', code: 'usd' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_currency', code: 'XQZ' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_currency', code: 'USD', rate: 1.1 }).success).toBe(false);
  });
});

describe('action shapes', () => {
  it('rejects unknown types, unknown keys and nonsense values', () => {
    expect(actionSchema.safeParse({ type: 'add_fuel_stop' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_priorities', priorities: ['luxury'] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_priorities', priorities: ['cheapest', 'cheapest'] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_priorities', priorities: ['basic'] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_priorities', priorities: ['cheapest', 'nicest'] }).success).toBe(true);
    // A producer may name a place, never a point.
    expect(actionSchema.safeParse({ type: 'set_near', placeId: 'ChIJ' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'set_near', placeId: 'ChIJ', latitude: 41, longitude: -8 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_near', near: { placeId: 'x', label: 'x', latitude: 1, longitude: 1 } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_destination', placeId: 'ChIJ', destinationText: 'Porto', point: { latitude: 1 } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_price_cap', perNightMinor: -5 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_price_cap', perNightMinor: 100, currency: 'USD' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'add_must_have', mustHave: 'quiet' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_dates', checkIn: 'next friday', checkOut: '2026-12-13' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_guests', adults: 0, childrenAges: [], rooms: 1 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_guests', adults: 2, childrenAges: [18], rooms: 1 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'exclude_property', propertyId: 'lp76a2a' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_nationality', code: 'es' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_nationality', code: 'ZZ' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_nationality', code: 'PT' }).success).toBe(true);
  });
});

describe('a point picked on the map ("Search around here")', () => {
  it('previews as a new place to be near: a new search around it', async () => {
    const { previewReduce } = await import('./reduce');
    const { MAP_POINT_LABEL, mapPointId } = await import('./actions');
    const r = previewReduce(state({ destPoint: { latitude: 41.15, longitude: -8.61 } }), { type: 'set_near_point', latitude: 41.1408, longitude: -8.613 }, TODAY);
    if (!r.ok) throw new Error(r.rejection);
    expect(r.effect).toBe('refetch');
    expect(r.state.stay.near).toEqual({ placeId: mapPointId(41.1408, -8.613), label: MAP_POINT_LABEL, latitude: 41.1408, longitude: -8.613 });
  });

  it('the same spot twice changes nothing; a spot in another city is refused like any place that far', async () => {
    const { previewReduce } = await import('./reduce');
    const { mapPointId } = await import('./actions');
    const near = { placeId: mapPointId(41.1408, -8.613), label: 'x', latitude: 41.1408, longitude: -8.613 };
    expect(previewReduce(state({ near }), { type: 'set_near_point', latitude: 41.14081, longitude: -8.61301 }, TODAY)).toEqual({ ok: false, rejection: 'no_change' });
    expect(previewReduce(state({ destPoint: { latitude: 41.15, longitude: -8.61 } }), { type: 'set_near_point', latitude: 38.72, longitude: -9.14 }, TODAY)).toEqual({ ok: false, rejection: 'near_too_far' });
  });

  it('the action schema bounds the point to the globe and takes nothing else', async () => {
    const { actionSchema } = await import('./actions');
    expect(actionSchema.safeParse({ type: 'set_near_point', latitude: 41.1, longitude: -8.6 }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'set_near_point', latitude: 91, longitude: 0 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_near_point', latitude: 41.1, longitude: -8.6, placeId: 'x' }).success).toBe(false);
    // A named place pressed on the map carries its name, and nothing longer than a name.
    expect(actionSchema.safeParse({ type: 'set_near_point', latitude: 41.1, longitude: -8.6, label: 'Campanhã' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'set_near_point', latitude: 41.1, longitude: -8.6, label: 'x'.repeat(81) }).success).toBe(false);
    const { previewReduce } = await import('./reduce');
    const r = previewReduce(state(), { type: 'set_near_point', latitude: 41.1, longitude: -8.6, label: 'Campanhã' }, TODAY);
    expect(r.ok && r.state.stay.near?.label).toBe('Campanhã');
  });
});

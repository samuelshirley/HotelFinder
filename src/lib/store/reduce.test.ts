import { describe, expect, it } from 'vitest';

import { actionSchema, type Action } from './actions';
import { fingerprint, reduce, reduceAll, type SearchState } from './reduce';

const TODAY = '2026-11-11';
const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';

const state = (over: Partial<SearchState['stay']> = {}, top: Partial<SearchState> = {}): SearchState => ({
  priority: null,
  guestNationality: 'ES',
  stay: {
    destinationText: 'Porto',
    placeId: 'place-porto',
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
    adults: 2,
    childrenAges: [],
    rooms: 1,
    priceCapMinor: null,
    mustHaves: [],
    excludedPropertyIds: [],
    ...over,
  },
  ...top,
});

const ok = (s: SearchState, a: Action) => {
  const r = reduce(s, a, TODAY);
  if (!r.ok) throw new Error(`rejected: ${r.rejection}`);
  return r;
};

describe('which changes need a new search and which only a re-rank', () => {
  it.each<[Action, 'rerank' | 'refetch']>([
    [{ type: 'set_priority', priority: 'cheapest' }, 'rerank'],
    [{ type: 'set_price_cap', perNightMinor: 12000 }, 'rerank'],
    [{ type: 'add_must_have', mustHave: 'parking' }, 'rerank'],
    [{ type: 'exclude_property', propertyId: P1 }, 'rerank'],
    [{ type: 'more_options', propertyIds: [P1, P2] }, 'rerank'],
    [{ type: 'set_guests', adults: 4, childrenAges: [4, 9], rooms: 2 }, 'refetch'],
    [{ type: 'set_dates', checkIn: '2026-12-11', checkOut: '2026-12-14' }, 'refetch'],
    [{ type: 'set_destination', placeId: 'place-lisbon', destinationText: 'Lisbon' }, 'refetch'],
    [{ type: 'set_nationality', code: 'PT' }, 'refetch'],
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
    const next = ok(s, { type: 'set_destination', placeId: 'place-lisbon', destinationText: 'Lisbon' }).state;
    expect(next.stay).toMatchObject({ placeId: 'place-lisbon', destinationText: 'Lisbon', excludedPropertyIds: [] });
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
        { type: 'set_priority', priority: 'cheapest' },
        { type: 'set_dates', checkIn: '2026-01-01', checkOut: '2026-01-02' },
        { type: 'add_must_have', mustHave: 'pool' },
      ],
      TODAY,
    );
    expect(after.priority).toBe('cheapest');
    expect(after.stay.mustHaves).toEqual(['pool']);
    expect(after.stay.checkIn).toBe('2026-12-11');
    expect(effect).toBe('rerank');
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(reduceAll(state(), [{ type: 'set_priority', priority: 'cheapest' }, { type: 'set_nationality', code: 'PT' }], TODAY).effect).toBe('refetch');
    expect(reduceAll(state(), [], TODAY).effect).toBe('none');
  });

  it('the fingerprint changes with any change and ignores list order', () => {
    const a = state({ mustHaves: ['pool', 'parking'] });
    const b = state({ mustHaves: ['parking', 'pool'] });
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(ok(a, { type: 'set_price_cap', perNightMinor: 1 }).state)).not.toBe(fingerprint(a));
    expect(fingerprint(state({}, { priority: 'nicest' }))).not.toBe(fingerprint(state()));
  });
});

describe('action shapes', () => {
  it('rejects unknown types, unknown keys and nonsense values', () => {
    expect(actionSchema.safeParse({ type: 'add_fuel_stop' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_priority', priority: 'luxury' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_price_cap', perNightMinor: -5 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_price_cap', perNightMinor: 100, currency: 'USD' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'add_must_have', mustHave: 'quiet' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_dates', checkIn: 'next friday', checkOut: '2026-12-13' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_guests', adults: 0, childrenAges: [], rooms: 1 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_guests', adults: 2, childrenAges: [18], rooms: 1 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'exclude_property', propertyId: 'lp76a2a' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'set_nationality', code: 'es' }).success).toBe(false);
  });
});

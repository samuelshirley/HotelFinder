import type { MustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import type { PriorityKey } from '@/lib/finder/rank';
import type { Action } from './actions';

/** The part of a search an action can change. A plain value: no database, no clock. */
export type SearchState = {
  priority: PriorityKey | null;
  guestNationality: string | null;
  stay: {
    destinationText: string;
    placeId: string | null;
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenAges: number[];
    rooms: number;
    priceCapMinor: number | null;
    mustHaves: MustHave[];
    excludedPropertyIds: string[];
  };
};

/**
 * What must happen after the state changed:
 *  - `refetch`: where, when or who changed, so held rates are for the wrong search;
 *  - `rerank`: the held rates still apply, only the order or the filter changed;
 *  - `none`: nothing the finder cares about.
 */
export type Effect = 'refetch' | 'rerank' | 'none';

export type Rejection =
  | 'dates_in_past'
  | 'checkout_not_after_checkin'
  | 'stay_too_long'
  | 'more_rooms_than_adults'
  | 'no_change';

export type Reduced = { ok: true; state: SearchState; effect: Effect } | { ok: false; rejection: Rejection };

export const MAX_NIGHTS = 30;

const stronger = (a: Effect, b: Effect): Effect => (a === 'refetch' || b === 'refetch' ? 'refetch' : a === 'rerank' || b === 'rerank' ? 'rerank' : 'none');

/** Pure. `today` is the user's date (YYYY-MM-DD), passed in. */
export function reduce(state: SearchState, action: Action, today: string): Reduced {
  const stay = state.stay;
  const withStay = (patch: Partial<SearchState['stay']>, effect: Effect): Reduced => ({
    ok: true,
    state: { ...state, stay: { ...stay, ...patch } },
    effect,
  });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  switch (action.type) {
    case 'set_priority':
      if (state.priority === action.priority) return { ok: false, rejection: 'no_change' };
      return { ok: true, state: { ...state, priority: action.priority }, effect: 'rerank' };

    case 'set_price_cap':
      if (stay.priceCapMinor === action.perNightMinor) return { ok: false, rejection: 'no_change' };
      return withStay({ priceCapMinor: action.perNightMinor }, 'rerank');

    case 'add_must_have':
      if (stay.mustHaves.includes(action.mustHave)) return { ok: false, rejection: 'no_change' };
      return withStay({ mustHaves: [...stay.mustHaves, action.mustHave] }, 'rerank');

    case 'remove_must_have':
      if (!stay.mustHaves.includes(action.mustHave)) return { ok: false, rejection: 'no_change' };
      return withStay({ mustHaves: stay.mustHaves.filter((m) => m !== action.mustHave) }, 'rerank');

    case 'set_guests': {
      if (action.rooms > action.adults) return { ok: false, rejection: 'more_rooms_than_adults' };
      const next = { adults: action.adults, childrenAges: action.childrenAges, rooms: action.rooms };
      if (same(next, { adults: stay.adults, childrenAges: stay.childrenAges, rooms: stay.rooms })) {
        return { ok: false, rejection: 'no_change' };
      }
      return withStay(next, 'refetch');
    }

    case 'set_dates': {
      if (action.checkIn < today) return { ok: false, rejection: 'dates_in_past' };
      const nights = nightsBetween(action.checkIn, action.checkOut);
      if (!(nights >= 1)) return { ok: false, rejection: 'checkout_not_after_checkin' };
      if (nights > MAX_NIGHTS) return { ok: false, rejection: 'stay_too_long' };
      if (stay.checkIn === action.checkIn && stay.checkOut === action.checkOut) return { ok: false, rejection: 'no_change' };
      return withStay({ checkIn: action.checkIn, checkOut: action.checkOut }, 'refetch');
    }

    case 'set_destination':
      if (stay.placeId === action.placeId) return { ok: false, rejection: 'no_change' };
      // A new place: what was set aside for the old one no longer means anything.
      return withStay({ placeId: action.placeId, destinationText: action.destinationText, excludedPropertyIds: [] }, 'refetch');

    case 'set_nationality':
      if (state.guestNationality === action.code) return { ok: false, rejection: 'no_change' };
      return { ok: true, state: { ...state, guestNationality: action.code }, effect: 'refetch' };

    case 'exclude_property':
      if (stay.excludedPropertyIds.includes(action.propertyId)) return { ok: false, rejection: 'no_change' };
      return withStay({ excludedPropertyIds: [...stay.excludedPropertyIds, action.propertyId] }, 'rerank');

    case 'more_options': {
      const merged = [...new Set([...stay.excludedPropertyIds, ...action.propertyIds])];
      if (merged.length === stay.excludedPropertyIds.length) return { ok: false, rejection: 'no_change' };
      return withStay({ excludedPropertyIds: merged }, 'rerank');
    }

    case 'reset_exclusions':
      if (stay.excludedPropertyIds.length === 0) return { ok: false, rejection: 'no_change' };
      return withStay({ excludedPropertyIds: [] }, 'rerank');
  }
}

export type Applied = { action: Action; ok: true } | { action: Action; ok: false; rejection: Rejection };

/** Apply actions in order. A rejected action changes nothing and does not stop the rest. */
export function reduceAll(state: SearchState, actions: Action[], today: string) {
  let current = state;
  let effect: Effect = 'none';
  const results: Applied[] = [];
  for (const action of actions) {
    const r = reduce(current, action, today);
    if (r.ok) {
      current = r.state;
      effect = stronger(effect, r.effect);
      results.push({ action, ok: true });
    } else {
      results.push({ action, ok: false, rejection: r.rejection });
    }
  }
  return { state: current, effect, results };
}

/** A fingerprint of everything a staged action was computed against. */
export function fingerprint(state: SearchState): string {
  const s = state.stay;
  return JSON.stringify([
    state.priority,
    state.guestNationality,
    s.placeId,
    s.checkIn,
    s.checkOut,
    s.adults,
    s.childrenAges,
    s.rooms,
    s.priceCapMinor,
    [...s.mustHaves].sort(),
    [...s.excludedPropertyIds].sort(),
  ]);
}

import type { MustHave } from '@/lib/amenities';
import { haversineKm, nightsBetween, type LatLng } from '@/lib/finder/geo';
import { canonicalPriorities, type PriorityKey } from '@/lib/finder/rank';
import { MAP_POINT_LABEL, mapPointId, type Action, type ResolvedAction, type ResolvedPoint } from './actions';

/** The part of a search an action can change. A plain value: no database, no clock. */
export type SearchState = {
  /** null = not asked yet; [] = no preference. Kept in canonical order. */
  priorities: PriorityKey[] | null;
  guestNationality: string | null;
  stay: {
    destinationText: string;
    placeId: string | null;
    /** The destination's own point and kind, from the supplier. null = unknown (lookup failed). */
    destPoint: LatLng | null;
    destKind: 'area' | 'point' | null;
    destCountry: string | null;
    /** A place the user named to be close to. null = measure from the destination. */
    near: ResolvedPoint | null;
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
  | 'near_too_far'
  /** Set by dispatch, not the reducer: the supplier could not say where a named place is. */
  | 'place_unavailable'
  | 'no_change';

export type Reduced = { ok: true; state: SearchState; effect: Effect } | { ok: false; rejection: Rejection };

export const MAX_NIGHTS = 30;

/** A place to be near must be within this of the destination; further is a different trip. */
export const NEAR_MAX_KM = 50;

const stronger = (a: Effect, b: Effect): Effect => (a === 'refetch' || b === 'refetch' ? 'refetch' : a === 'rerank' || b === 'rerank' ? 'rerank' : 'none');

/** Pure. `today` is the user's date (YYYY-MM-DD), passed in. */
export function reduce(state: SearchState, action: ResolvedAction, today: string): Reduced {
  const stay = state.stay;
  const withStay = (patch: Partial<SearchState['stay']>, effect: Effect): Reduced => ({
    ok: true,
    state: { ...state, stay: { ...stay, ...patch } },
    effect,
  });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  switch (action.type) {
    case 'set_priorities': {
      const next = canonicalPriorities(action.priorities);
      if (state.priorities !== null && same(next, canonicalPriorities(state.priorities))) return { ok: false, rejection: 'no_change' };
      return { ok: true, state: { ...state, priorities: next }, effect: 'rerank' };
    }

    case 'set_near': {
      if (stay.near?.placeId === action.near.placeId) return { ok: false, rejection: 'no_change' };
      if (stay.destPoint && haversineKm(stay.destPoint, action.near) > NEAR_MAX_KM) return { ok: false, rejection: 'near_too_far' };
      // A new point to search around, not just a re-sort: the hotels near it may not be in hand.
      return withStay({ near: action.near }, 'refetch');
    }

    case 'clear_near':
      if (!stay.near) return { ok: false, rejection: 'no_change' };
      return withStay({ near: null }, 'refetch');

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
      // A new place: what was set aside for the old one, and where to be close
      // to in it, no longer mean anything.
      return withStay(
        {
          placeId: action.placeId,
          destinationText: action.destinationText,
          destPoint: action.point ? { latitude: action.point.latitude, longitude: action.point.longitude } : null,
          destKind: action.point?.kind ?? null,
          destCountry: action.point?.country ?? null,
          near: null,
          excludedPropertyIds: [],
        },
        'refetch',
      );

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

/**
 * For a producer (the agent) checking actions before it queues them, with no
 * supplier at hand: a named place is not looked up here, so `set_near` passes
 * unless it repeats the current place, and a new destination carries no point.
 * Dispatch looks both up and runs the real reducer.
 */
export function previewReduce(state: SearchState, action: Action, today: string): Reduced {
  if (action.type === 'set_near') {
    return state.stay.near?.placeId === action.placeId ? { ok: false, rejection: 'no_change' } : { ok: true, state, effect: 'refetch' };
  }
  if (action.type === 'set_near_point') {
    return reduce(state, { type: 'set_near', near: { placeId: mapPointId(action.latitude, action.longitude), label: MAP_POINT_LABEL, latitude: action.latitude, longitude: action.longitude } }, today);
  }
  if (action.type === 'set_destination') return reduce(state, { ...action, point: null }, today);
  return reduce(state, action, today);
}

export type Applied = { action: ResolvedAction; ok: true } | { action: ResolvedAction; ok: false; rejection: Rejection };

/** Apply actions in order. A rejected action changes nothing and does not stop the rest. */
export function reduceAll(state: SearchState, actions: ResolvedAction[], today: string) {
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
    state.priorities === null ? null : canonicalPriorities(state.priorities),
    state.guestNationality,
    s.placeId,
    s.near?.placeId ?? null,
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

import 'server-only';

import { isMustHave, type MustHave } from '@/lib/amenities';
import { canonicalPriorities } from '@/lib/finder/rank';
import { destinationKind } from '@/lib/finder/searchPlan';
import { MAP_POINT_LABEL, mapPointId, type Action, type ResolvedAction } from '@/lib/store/actions';
import { reduceAll, type Applied, type Effect, type SearchState } from '@/lib/store/reduce';
import { runFinder, type FinderOutcome } from '@/server/finder';
import { updateSession, updateStay, type SearchSession, type Stay } from '@/server/repos/sessions';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * The one path every change takes, whoever produced it (the form, the Jev
 * router, the agent): validate against current state → persist → run the
 * finder → return what actually happened. Callers report this result; they
 * never claim a change in advance.
 */

export function toSearchState(session: SearchSession, stay: Stay): SearchState {
  return {
    priorities: session.priorities ? canonicalPriorities(session.priorities) : null,
    guestNationality: session.guestNationality,
    stay: {
      destinationText: stay.destinationText,
      placeId: stay.placeId,
      destPoint: stay.destLatitude !== null && stay.destLongitude !== null ? { latitude: stay.destLatitude, longitude: stay.destLongitude } : null,
      destKind: stay.destKind,
      destCountry: stay.destCountry,
      near:
        stay.nearPlaceId && stay.nearLabel && stay.latitude !== null && stay.longitude !== null
          ? { placeId: stay.nearPlaceId, label: stay.nearLabel, latitude: stay.latitude, longitude: stay.longitude }
          : null,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      childrenAges: stay.childrenAges,
      rooms: stay.rooms,
      priceCapMinor: stay.priceCapMinor,
      mustHaves: stay.mustHaves.filter(isMustHave) as MustHave[],
      excludedPropertyIds: stay.excludedPropertyIds,
    },
  };
}

export type DispatchResult = {
  results: Applied[];
  effect: Effect;
  state: SearchState;
  /** null when nothing changed, so the finder was not run. */
  finder: FinderOutcome | null;
};

export async function dispatchActions(args: {
  session: SearchSession;
  stay: Stay;
  actions: Action[];
  supplier: SupplierAdapter;
  now: Date;
  /** The user's date, YYYY-MM-DD. */
  today: string;
  /** Run the finder even if no action changed anything (first search after onboarding). */
  alwaysRun?: boolean;
}): Promise<DispatchResult> {
  const { session, stay, supplier, now } = args;
  const before = toSearchState(session, stay);

  // Every place id becomes the supplier's point for it, here and only here.
  const resolved: ResolvedAction[] = [];
  const unresolved: Applied[] = [];
  for (const action of args.actions) {
    if (action.type === 'set_near') {
      const place = await supplier.getPlace(action.placeId);
      if (!place.ok) {
        unresolved.push({ action: { type: 'clear_near' }, ok: false, rejection: 'place_unavailable' });
        continue;
      }
      const { placeId, name, latitude, longitude } = place.value;
      resolved.push({ type: 'set_near', near: { placeId, label: name, latitude, longitude } });
    } else if (action.type === 'set_near_point') {
      // The user's own map point: nothing to look up. It becomes the same resolved action a named place does.
      resolved.push({ type: 'set_near', near: { placeId: mapPointId(action.latitude, action.longitude), label: MAP_POINT_LABEL, latitude: action.latitude, longitude: action.longitude } });
    } else if (action.type === 'set_destination') {
      resolved.push({ ...action, point: await resolveDestination(supplier, action.placeId, action.destinationText) });
    } else {
      resolved.push(action);
    }
  }

  const reduced = reduceAll(before, resolved, args.today);
  const { state, effect } = reduced;
  const results = [...reduced.results, ...unresolved];

  if (effect !== 'none') {
    const samePriorities = JSON.stringify(state.priorities) === JSON.stringify(before.priorities);
    if (!samePriorities || state.guestNationality !== before.guestNationality) {
      await updateSession(session.id, {
        priorities: state.priorities,
        guestNationality: state.guestNationality,
        // A changed nationality came from the user (the chip or a message): it is theirs now.
        ...(state.guestNationality !== before.guestNationality ? { nationalitySource: 'user' as const } : {}),
      });
    }
    await updateStay(stay.id, session.id, {
      destinationText: state.stay.destinationText,
      placeId: state.stay.placeId,
      destLatitude: state.stay.destPoint?.latitude ?? null,
      destLongitude: state.stay.destPoint?.longitude ?? null,
      destKind: state.stay.destKind,
      destCountry: state.stay.destCountry,
      latitude: state.stay.near?.latitude ?? null,
      longitude: state.stay.near?.longitude ?? null,
      nearPlaceId: state.stay.near?.placeId ?? null,
      nearLabel: state.stay.near?.label ?? null,
      checkIn: state.stay.checkIn,
      checkOut: state.stay.checkOut,
      adults: state.stay.adults,
      childrenAges: state.stay.childrenAges,
      rooms: state.stay.rooms,
      priceCapMinor: state.stay.priceCapMinor,
      mustHaves: state.stay.mustHaves,
      excludedPropertyIds: state.stay.excludedPropertyIds,
    });
  }

  const finder =
    effect !== 'none' || args.alwaysRun
      ? await runFinder({ sessionId: session.id, stayId: stay.id, supplier, now, refresh: effect === 'refetch' })
      : null;

  return { results, effect, state, finder };
}

/**
 * A destination's point, kind and country from the supplier. A failed lookup
 * is not fatal: the search still runs on the place id, and distance falls
 * back to the middle of the results (the reason says so).
 */
export async function resolveDestination(supplier: SupplierAdapter, placeId: string, label: string) {
  const place = await supplier.getPlace(placeId);
  if (!place.ok) return null;
  return {
    placeId,
    label,
    latitude: place.value.latitude,
    longitude: place.value.longitude,
    kind: destinationKind(place.value.types),
    country: place.value.countryCode,
  };
}

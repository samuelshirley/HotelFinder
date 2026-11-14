import 'server-only';

import { isMustHave, type MustHave } from '@/lib/amenities';
import { stayFilters } from '@/lib/filters';
import { canonicalPriorities } from '@/lib/finder/rank';
import { destinationKind } from '@/lib/finder/searchPlan';
import { MIN_SIGHTS, pickSights, readStaySights } from '@/lib/sights';
import { mapPointNear, type Action, type ResolvedAction } from '@/lib/store/actions';
import { reduceAll, type Applied, type Effect, type SearchState } from '@/lib/store/reduce';
import { runFinder, type FinderOutcome } from '@/server/finder';
import { updateSession, updateStay, type SearchSession, type Stay } from '@/server/repos/sessions';
import { getSightsFinder, type FindSights } from '@/server/sights';
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
    currency: session.currency,
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
      sights: readStaySights(stay.sights),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      childrenAges: stay.childrenAges,
      rooms: stay.rooms,
      priceCapMinor: stay.priceCapMinor,
      mustHaves: stay.mustHaves.filter(isMustHave) as MustHave[],
      filters: stayFilters(stay),
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
  /** The sights lookup. Left out: the configured one (Google), metered to this session. */
  findSights?: FindSights;
}): Promise<DispatchResult> {
  const { session, stay, supplier, now } = args;
  const before = toSearchState(session, stay);
  const findSights = args.findSights ?? getSightsFinder({ sessionId: session.id, userId: session.userId });

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
      resolved.push({ type: 'set_near', near: mapPointNear(action) });
    } else if (action.type === 'set_destination') {
      resolved.push({ ...action, point: await resolveDestination(supplier, action.placeId, action.destinationText) });
    } else if (action.type === 'set_sights') {
      // The kind becomes Google's most popular places of that kind around the destination, here and only here.
      // Looked up around the destination this stay has NOW: a destination changed in the same message is not a case built for.
      const centre = before.stay.destPoint;
      const found = centre ? await findSights(action.kind, centre) : null;
      if (!found?.ok) {
        unresolved.push({ action: { type: 'clear_sights' }, ok: false, rejection: 'sights_unavailable' });
        continue;
      }
      const places = pickSights(found.places, centre);
      if (places.length < MIN_SIGHTS) {
        unresolved.push({ action: { type: 'clear_sights' }, ok: false, rejection: 'sights_none' });
        continue;
      }
      resolved.push({ type: 'set_sights', sights: { kind: action.kind, places } });
      // Sights are somewhere to be close to, so closeness joins what "best" means, next to what was picked
      // before. Added here, once the places are in hand: a lookup that failed must change nothing at all.
      const wanted = before.priorities ?? [];
      if (!wanted.includes('closest') && !args.actions.some((a) => a.type === 'set_priorities')) {
        resolved.push({ type: 'set_priorities', priorities: canonicalPriorities([...wanted, 'closest']) });
      }
    } else {
      resolved.push(action);
    }
  }

  const reduced = reduceAll(before, resolved, args.today);
  const { state, effect } = reduced;
  const results = [...reduced.results, ...unresolved];

  if (effect !== 'none') {
    const samePriorities = JSON.stringify(state.priorities) === JSON.stringify(before.priorities);
    if (!samePriorities || state.guestNationality !== before.guestNationality || state.currency !== before.currency) {
      await updateSession(session.id, {
        priorities: state.priorities,
        guestNationality: state.guestNationality,
        currency: state.currency,
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
      sights: state.stay.sights,
      checkIn: state.stay.checkIn,
      checkOut: state.stay.checkOut,
      adults: state.stay.adults,
      childrenAges: state.stay.childrenAges,
      rooms: state.stay.rooms,
      priceCapMinor: state.stay.priceCapMinor,
      mustHaves: state.stay.mustHaves,
      minStars: state.stay.filters.minStars,
      minRating: state.stay.filters.minRating,
      propertyTypes: state.stay.filters.propertyTypes,
      chains: state.stay.filters.chains,
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

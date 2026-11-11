import 'server-only';

import { isMustHave, type MustHave } from '@/lib/amenities';
import type { Action } from '@/lib/store/actions';
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
    priority: session.priority,
    guestNationality: session.guestNationality,
    stay: {
      destinationText: stay.destinationText,
      placeId: stay.placeId,
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
  const { state, effect, results } = reduceAll(before, args.actions, args.today);

  if (effect !== 'none') {
    if (state.priority !== before.priority || state.guestNationality !== before.guestNationality) {
      await updateSession(session.id, { priority: state.priority, guestNationality: state.guestNationality });
    }
    await updateStay(stay.id, session.id, {
      destinationText: state.stay.destinationText,
      placeId: state.stay.placeId,
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

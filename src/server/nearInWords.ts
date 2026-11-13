import 'server-only';

import { canonicalPriorities, type PriorityKey } from '@/lib/finder/rank';
import { placeName } from '@/lib/finder/searchPlan';
import { pickNearPlace } from '@/lib/placePick';
import { copy } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';
import { describeChange, fixedLine } from '@/lib/replies';
import type { Action } from '@/lib/store/actions';
import { readPriorities, type CallModel } from '@/server/agent';
import { dispatchActions } from '@/server/dispatch';
import { logModelCalls } from '@/server/modelLedger';
import type { SearchSession, Stay } from '@/server/repos/sessions';
import { aiBudget } from '@/server/spend';
import type { SupplierAdapter } from '@/server/supplier';
import type { ModelId } from '@/lib/models';

/**
 * "I wanna stay on East Manor" on a running search (Jev: wants a location AND
 * names a place). The message wins over what was clicked before: the place is
 * looked up INSIDE the town being searched, "close" is measured from it, and
 * closest joins what "best" means (the earlier picks stay, so low price + close).
 * The words are read by one forced Haiku call; everything after is code:
 * the lookup, the pick (lib/placePick.ts pickNearPlace), the search.
 *
 * A town is never a place to be near (that is a new trip: the agent's). Two real
 * places with that name: Penny asks, with a button for each.
 */
export type NearChoice = { placeId: string; label: string };
export type NearResult =
  | { kind: 'done'; text: string; meta: Record<string, unknown> }
  | { kind: 'ask'; text: string; meta: Record<string, unknown> }
  | { kind: 'not_mine'; meta: Record<string, unknown> };

export async function nearInWords(args: {
  session: SearchSession;
  stay: Stay;
  message: string;
  priorities: readonly PriorityKey[] | null;
  supplier: SupplierAdapter;
  callModel: CallModel;
  model: ModelId;
  now: Date;
  today: string;
  locale?: Locale;
}): Promise<NearResult> {
  const { session, stay, supplier } = args;
  const L = args.locale ?? 'en';
  const o = copy(L).onboarding;
  const budget = await aiBudget(session.id, args.now);
  if (!budget.ok) return { kind: 'done', text: fixedLine('ai_budget', L), meta: { near: 'budget' } };
  const read = await readPriorities({ message: args.message, destination: stay.destinationText, callModel: args.callModel, model: args.model });
  const spent = await logModelCalls(session, 'near', [read.reply]);
  const reading = read.reading;
  if (!reading?.nearQuery) return { kind: 'not_mine', meta: { near: 'no_place', ...spent } };

  const town = placeName(stay.destinationText);
  let lookupFailed = false;
  for (const words of [reading.nearQueryLocal, reading.nearQuery].filter((w): w is string => !!w)) {
    const found = await supplier.searchPlaces(`${words}, ${town}`);
    if (!found.ok) {
      lookupFailed = true;
      break;
    }
    const pick = pickNearPlace(words, found.value);
    if (pick.kind === 'none') continue;
    // The message adds "close" to what was picked before; it does not throw it away.
    const priorities = canonicalPriorities([...(args.priorities ?? []), ...reading.priorities, 'closest']);
    if (pick.kind === 'ask') {
      const choices: NearChoice[] = pick.places.map((p) => ({ placeId: p.placeId, label: p.address ? `${p.name} · ${p.address}` : p.name }));
      return {
        kind: 'ask',
        text: o.whichNear(reading.nearQuery),
        // `ui` is kept on the chat message: the choices render as buttons.
        meta: { near: 'ask', ui: { nearChoices: choices, priorities }, ...spent },
      };
    }
    const actions: Action[] = [
      { type: 'set_near', placeId: pick.place.placeId },
      { type: 'set_priorities', priorities },
    ];
    const dispatched = await dispatchActions({ session, stay, actions, supplier, now: args.now, today: args.today });
    return {
      kind: 'done',
      text: describeChange(dispatched.results, dispatched.state, session.currency, dispatched.finder, L),
      meta: {
        near: 'set',
        actions,
        applied: dispatched.results.filter((r) => r.ok).length,
        rejected: dispatched.results.flatMap((r) => (r.ok ? [] : [r.rejection])),
        finder: dispatched.finder?.kind ?? null,
        // Penny offers the other reading in one tap: closeness alone.
        ui: priorities.length > 1 ? { onlyClosest: true } : undefined,
        ...spent,
      },
    };
  }
  if (lookupFailed) return { kind: 'done', text: o.nearLookupFailedNothingChanged, meta: { near: 'lookup_failed', ...spent } };
  return {
    kind: 'done',
    text: o.couldNotFindNear(reading.nearQuery, town),
    meta: { near: 'not_found', ...spent },
  };
}

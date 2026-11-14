import 'server-only';

import type { LatLng } from '@/lib/finder/geo';
import type { Sight, SightKind } from '@/lib/sights';
import { GOOGLE_NEARBY_MICROCENTS } from '@/lib/supplierPrices';
import { logUsage } from '@/server/repos/usage';
import { searchNearby, type FetchLike, type SightsError } from './google';

/**
 * BOUNDED MODULE: the sights lookup (docs/sights.md). This file is the only
 * thing the rest of the app may import from `sights/`, and dispatch is its
 * only caller: a sight reaches a stay the way a named place does, looked up
 * in code for a typed action, never authored by a producer.
 *
 * Every call that reached Google writes one usage row (`google:places`).
 * `GOOGLE_MAPS_API_KEY` is server-only: never NEXT_PUBLIC_ here.
 */
export type FindSightsResult = { ok: true; places: Sight[] } | { ok: false; error: SightsError | 'not_configured' };
/** The popular places of one kind around a point, as Google ranks them. Never throws. */
export type FindSights = (kind: SightKind, centre: LatLng) => Promise<FindSightsResult>;

type SightsContext = { sessionId?: string | null; userId?: string | null; language?: string; apiKey?: string; fetchImpl?: FetchLike };

export function getSightsFinder(context: SightsContext = {}): FindSights {
  return async (kind, centre) => {
    const apiKey = context.apiKey ?? process.env.GOOGLE_MAPS_API_KEY?.trim();
    // Not configured is not a call: nothing to meter (the same rule as Jev).
    if (!apiKey) return { ok: false, error: 'not_configured' };
    const outcome = await searchNearby({ apiKey, kind, centre, language: context.language, fetchImpl: context.fetchImpl });
    await logUsage({
      provider: 'google:places',
      latencyMs: outcome.latencyMs,
      success: outcome.ok,
      errorMessage: outcome.ok ? null : outcome.status === null ? outcome.error : `${outcome.error} ${outcome.status}`,
      // Google bills a request it answered; a refused or lost one is not billed.
      costMicrocents: outcome.ok ? GOOGLE_NEARBY_MICROCENTS : 0,
      meta: { op: 'nearby', sku: 'nearby_search_enterprise', kind, found: outcome.ok ? outcome.places.length : null },
      sessionId: context.sessionId ?? null,
      userId: context.userId ?? null,
    });
    return outcome.ok ? { ok: true, places: outcome.places } : { ok: false, error: outcome.error };
  };
}

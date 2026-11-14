import type { LatLng } from '@/lib/finder/geo';
import { GOOGLE_PRIMARY_TYPES, parsePlaces, SIGHTS_RADIUS_M, type Sight, type SightKind } from '@/lib/sights';

/**
 * One call to Google Places (New) Nearby Search: the popular places of one
 * kind around a town's point. The only file that talks to Google
 * (meterGuard.test.ts); `./index` meters every call.
 *
 * Nearby, not Text Search: it takes place types and a hard circle, ranks by
 * popularity, and needs no query in any language. The field mask asks for the
 * rating and the review count, which makes it the Enterprise SKU
 * (lib/supplierPrices.ts). Nothing else is asked for.
 *
 * Every outcome is a value; nothing here throws, and no error string carries
 * the key, the request or the response body.
 */
export const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
export const FIELD_MASK = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.primaryType,places.businessStatus';
export const SIGHTS_TIMEOUT_MS = 6_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SightsError = 'timeout' | 'network' | 'http' | 'bad_json';
export type SightsOutcome =
  | { ok: true; places: Sight[]; latencyMs: number }
  | { ok: false; error: SightsError; status: number | null; latencyMs: number };

export function nearbyBody(kind: SightKind, centre: LatLng, language: string) {
  return {
    includedPrimaryTypes: [...GOOGLE_PRIMARY_TYPES[kind]],
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    languageCode: language,
    locationRestriction: { circle: { center: { latitude: centre.latitude, longitude: centre.longitude }, radius: SIGHTS_RADIUS_M } },
  };
}

export async function searchNearby(options: {
  apiKey: string;
  kind: SightKind;
  centre: LatLng;
  language?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  clock?: () => number;
}): Promise<SightsOutcome> {
  const { apiKey, kind, centre, language = 'en', timeoutMs = SIGHTS_TIMEOUT_MS, fetchImpl = fetch, clock = Date.now } = options;
  const started = clock();
  const elapsed = () => clock() - started;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fail = (error: SightsError, status: number | null): SightsOutcome => ({ ok: false, error, status, latencyMs: elapsed() });

  try {
    const res = await fetchImpl(NEARBY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(nearbyBody(kind, centre, language)),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return fail('http', res.status);
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return fail(controller.signal.aborted ? 'timeout' : 'bad_json', res.status);
    }
    return { ok: true, places: parsePlaces(parsed, kind), latencyMs: elapsed() };
  } catch {
    // Which of the two it was is all that is kept: a fetch error's message can hold the URL.
    return fail(controller.signal.aborted ? 'timeout' : 'network', null);
  } finally {
    clearTimeout(timer);
  }
}

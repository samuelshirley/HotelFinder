import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizePlaces, normalizeRates, normalizeStaticFacts } from '@/server/supplier/liteapi/normalize';
import { hotelListResponse, placesResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import type { SearchRequest, SupplierAdapter, SupplierError } from '@/server/supplier/types';

export const RECORDED_AT = new Date('2026-11-11T12:00:00Z');
export const DOWN: SupplierError = { kind: 'timeout', status: null, code: null, message: 'timed out after 20000 ms', retryable: true };

/** A supplier that answers from the recorded sandbox responses and counts what it was asked. */
export function recordedSupplier(over: Partial<Record<'search' | 'facts' | 'places', 'fail' | 'empty'>> = {}) {
  const searches: SearchRequest[] = [];
  const placeQueries: string[] = [];
  let factCalls = 0;
  const unused = async () => {
    throw new Error('not used here');
  };
  const supplier: SupplierAdapter = {
    name: 'liteapi',
    getStaticContent: unused,
    recheckRate: unused,
    book: unused,
    getBooking: unused,
    cancel: unused,
    async searchPlaces(query) {
      placeQueries.push(query);
      if (over.places === 'fail') return { ok: false, error: DOWN };
      if (over.places === 'empty') return { ok: true, value: [] };
      return { ok: true, value: normalizePlaces(placesResponse.parse(fixture('places-porto-ribeira'))) };
    },
    async searchAvailability(request) {
      searches.push(request);
      if (over.search === 'fail') return { ok: false, error: DOWN };
      if (over.search === 'empty') return { ok: true, value: { properties: [], offers: [] } };
      // The recording that matches the margin asked for: net for members, +15% for the public.
      const name = request.marginPct >= 15 ? 'rates-city-porto-margin-15' : 'rates-city-porto';
      return { ok: true, value: normalizeRates(ratesResponse.parse(fixture(name)), request.marginPct, RECORDED_AT) };
    },
    async getStaticFacts() {
      factCalls += 1;
      if (over.facts === 'fail') return { ok: false, error: DOWN };
      return { ok: true, value: normalizeStaticFacts(hotelListResponse.parse(fixture('hotels-static-porto'))) };
    },
  };
  return { supplier, searches, placeQueries, facts: () => factCalls };
}

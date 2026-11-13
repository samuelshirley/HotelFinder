import { fixture, recordedPlaceIds } from '@/server/supplier/liteapi/fixtures';
import { normalizeDetails, normalizePlaceDetails, normalizePlaces, normalizeRates, normalizeStaticFacts } from '@/server/supplier/liteapi/normalize';
import { hotelDetailsResponse, hotelListResponse, placeDetailsResponse, placesResponse, ratesResponse } from '@/server/supplier/liteapi/schemas';
import type { SearchRequest, SupplierAdapter, SupplierError } from '@/server/supplier/types';

export const RECORDED_AT = new Date('2026-11-11T12:00:00Z');
export const DOWN: SupplierError = { kind: 'timeout', status: null, code: null, message: 'timed out after 20000 ms', retryable: true };

/** A supplier that answers from the recorded sandbox responses and counts what it was asked. */
/** Recorded place details by the real place id they were recorded for. An id with no recording is an error. */
const RECORDED_PLACES = recordedPlaceIds();
export const PLACE_IDS = {
  porto: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY',
  annecy: 'ChIJu_5hWOWPi0cRK4mrtTKskGo',
  vieilleVille: 'ChIJiwiZIvuPi0cRxR3T-_CdlvY',
  opo: 'ChIJrStKYWRvJA0R0TlgbYpXGhU',
  bcn: 'ChIJpY58hGSepBIR15tv-0LpK_M',
} as const;

export function recordedSupplier(over: Partial<Record<'search' | 'facts' | 'places' | 'place', 'fail' | 'empty'>> = {}, placesFor: (query: string) => string = () => 'places-porto-ribeira') {
  const searches: SearchRequest[] = [];
  const placeQueries: string[] = [];
  const placeLookups: string[] = [];
  let factCalls = 0;
  const unused = async () => {
    throw new Error('not used here');
  };
  const supplier: SupplierAdapter = {
    name: 'liteapi',
    async getStaticContent() {
      return { ok: true, value: normalizeDetails(hotelDetailsResponse.parse(fixture('hotel-details'))) };
    },
    recheckRate: unused,
    book: unused,
    getBooking: unused,
    cancel: unused,
    async searchPlaces(query) {
      placeQueries.push(query);
      if (over.places === 'fail') return { ok: false, error: DOWN };
      if (over.places === 'empty') return { ok: true, value: [] };
      return { ok: true, value: normalizePlaces(placesResponse.parse(fixture(placesFor(query)))) };
    },
    async getPlace(placeId) {
      placeLookups.push(placeId);
      if (over.place === 'fail') return { ok: false, error: DOWN };
      const name = RECORDED_PLACES.get(placeId);
      if (!name) throw new Error(`no recorded place for ${placeId}`);
      return { ok: true, value: normalizePlaceDetails(placeId, placeDetailsResponse.parse(fixture(name))) };
    },
    async searchAvailability(request) {
      searches.push(request);
      if (over.search === 'fail') return { ok: false, error: DOWN };
      if (over.search === 'empty') return { ok: true, value: { properties: [], offers: [] } };
      // The recording that matches the currency and margin asked for: net for members, +15% for the public.
      // Only EUR and member-margin USD are recorded; anything else is a test asking for a payload nobody captured.
      if (request.currency !== 'EUR' && !(request.currency === 'USD' && request.marginPct < 15 && !('radiusM' in request.where))) {
        throw new Error(`no recording for ${request.currency} at a ${request.marginPct}% margin`);
      }
      const name =
        request.currency === 'USD'
          ? 'rates-city-porto-usd'
          : 'radiusM' in request.where ? 'rates-radius-porto-airport' : request.marginPct >= 15 ? 'rates-city-porto-margin-15' : 'rates-city-porto';
      return { ok: true, value: normalizeRates(ratesResponse.parse(fixture(name)), request.marginPct, RECORDED_AT) };
    },
    async getStaticFacts() {
      factCalls += 1;
      if (over.facts === 'fail') return { ok: false, error: DOWN };
      return { ok: true, value: normalizeStaticFacts(hotelListResponse.parse(fixture('hotels-static-porto'))) };
    },
  };
  return { supplier, searches, placeQueries, placeLookups, facts: () => factCalls };
}

import type { z } from 'zod';

import type {
  BookRequest,
  CancelResult,
  Place,
  PlaceDetails,
  PropertyDetails,
  RateCheck,
  SearchRequest,
  SearchResult,
  StaticFacts,
  SupplierAdapter,
  SupplierBooking,
  SupplierError,
  SupplierMeterEvent,
  SupplierResult,
} from '../types';
import { supplierCall, type SupplierOp } from '@/lib/supplierPrices';

import { callLiteApi, type FetchLike } from './http';
import {
  normalizeBooking,
  normalizeCancel,
  normalizeDetails,
  normalizePlaceDetails,
  normalizePlaces,
  normalizePrebook,
  normalizeRates,
  normalizeStaticFacts,
  SUPPLIER,
} from './normalize';
import {
  bookingResponse,
  cancelResponse,
  errorBody,
  hotelDetailsResponse,
  hotelListResponse,
  placeDetailsResponse,
  placesResponse,
  prebookResponse,
  ratesResponse,
} from './schemas';

const DATA = 'https://api.liteapi.travel/v3.0';
const BOOK = 'https://book.liteapi.travel/v3.0';

/** The supplier's "no availability found". An empty result, not a failure. */
const NO_AVAILABILITY = 2001;

/** Search is documented under 3 s; prebook and book at 5–10 s each. */
const TIMEOUTS = { places: 10_000, search: 20_000, content: 15_000, prebook: 30_000, book: 45_000, booking: 20_000 };

/**
 * A place lookup refused with 429 is asked again after these waits. Measured on
 * the sandbox (2026-11-14): about 5 place searches a second per key, shared by
 * every visitor, and the trip box looks places up as the words are typed, so
 * the first message's own lookup was refused ("La búsqueda de lugares no ha
 * respondido", docs/supplier.md "Rate limits"). Lookups only: they change
 * nothing at the supplier. Never the book call.
 */
export const PLACE_RETRY_WAITS_MS = [500, 1_000] as const;

export type LiteApiDeps = {
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Called once per supplier call. A failing meter is reported, never thrown into the call. */
  meter?: (event: SupplierMeterEvent) => Promise<void> | void;
  onMeterError?: (err: unknown) => void;
  /**
   * The language for place names and hotel text (ISO 639-1, e.g. "es"). Measured on
   * the sandbox (2026-11-13): /data/places and /data/hotel take `language`; the
   * facility names stay English either way, so amenity matching is unaffected.
   * Absent or "en": no parameter, the supplier's default.
   */
  language?: string;
  /** Waits between retries of a rate-limited lookup. Tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
};

/** LiteAPI sandbox keys start `sand_`; nothing booked with one is real. */
export const isSandboxKey = (key: string) => key.startsWith('sand_');

export function createLiteApiAdapter(deps: LiteApiDeps): SupplierAdapter {
  const now = deps.now ?? (() => new Date());
  const lang = deps.language && deps.language !== 'en' ? `language=${encodeURIComponent(deps.language)}` : null;
  const withLang = (url: string) => (lang ? `${url}${url.includes('?') ? '&' : '?'}${lang}` : url);
  const onMeterError = deps.onMeterError ?? ((err) => console.error('[liteapi] usage meter failed', err));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** A read-only lookup, asked again while the supplier answers 429. Every attempt is metered: each is a request. */
  async function lookup<T>(attempt: () => Promise<SupplierResult<T>>): Promise<SupplierResult<T>> {
    for (let i = 0; ; i++) {
      const result = await attempt();
      if (result.ok || result.error.status !== 429 || i >= PLACE_RETRY_WAITS_MS.length) return result;
      await sleep(PLACE_RETRY_WAITS_MS[i]);
    }
  }

  async function record(event: SupplierMeterEvent) {
    try {
      await deps.meter?.(event);
    } catch (err) {
      onMeterError(err);
    }
  }

  /**
   * One call: HTTP, the supplier's own error body (which can arrive with a
   * 200), schema validation, normalization, and exactly one meter event.
   */
  async function run<S extends z.ZodTypeAny, T>(spec: {
    op: SupplierOp;
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    body?: unknown;
    timeoutMs: number;
    schema: S;
    normalize: (parsed: z.infer<S>) => T;
    /** Turn a supplier error code into a normal result (no availability). */
    onSupplierError?: (code: number | null) => T | undefined;
    meta?: (value: T) => Record<string, unknown>;
  }): Promise<SupplierResult<T>> {
    const provider = `${SUPPLIER}:${spec.op}`;
    // List price per call, failures included: a refused request is still a request (src/lib/supplierPrices.ts).
    const { costMicrocents, pricing } = supplierCall(spec.op);
    const priced = { costMicrocents, pricing, sandbox: isSandboxKey(deps.apiKey) };
    const http = await callLiteApi({
      apiKey: deps.apiKey,
      method: spec.method,
      url: spec.url,
      body: spec.body,
      timeoutMs: spec.timeoutMs,
      fetchImpl: deps.fetchImpl,
    });

    const fail = async (error: SupplierError): Promise<SupplierResult<T>> => {
      await record({
        provider,
        latencyMs: http.latencyMs,
        success: false,
        errorMessage: error.message,
        costMicrocents: priced.costMicrocents,
        meta: { kind: error.kind, status: error.status, code: error.code, pricing: priced.pricing, sandbox: priced.sandbox },
      });
      return { ok: false, error };
    };
    const succeed = async (value: T, status: number): Promise<SupplierResult<T>> => {
      await record({ provider, latencyMs: http.latencyMs, success: true, errorMessage: null, costMicrocents: priced.costMicrocents, meta: { status, pricing: priced.pricing, sandbox: priced.sandbox, ...spec.meta?.(value) } });
      return { ok: true, value };
    };

    if (!http.ok) return fail(http.error);

    const asError = errorBody.safeParse(http.body);
    if (asError.success) {
      const code = asError.data.error.code ?? null;
      const mapped = spec.onSupplierError?.(code);
      if (mapped !== undefined) return succeed(mapped, http.status);
      return fail({
        kind: 'supplier',
        status: http.status,
        code,
        // The supplier's own short description. It names a field, never echoes the request.
        message: (asError.data.error.description ?? asError.data.error.message ?? 'supplier error').slice(0, 160),
        retryable: http.status === 429 || http.status >= 500,
      });
    }
    if (http.status < 200 || http.status >= 300) {
      return fail({ kind: 'http', status: http.status, code: null, message: `HTTP ${http.status}`, retryable: http.status === 429 || http.status >= 500 });
    }

    const parsed = spec.schema.safeParse(http.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail({
        kind: 'schema',
        status: http.status,
        code: null,
        // The path and the rule, never the value.
        message: `unexpected response shape at ${issue.path.join('.') || '(root)'}: ${issue.code}`,
        retryable: false,
      });
    }
    try {
      return succeed(spec.normalize(parsed.data), http.status);
    } catch (err) {
      return fail({
        kind: 'schema',
        status: http.status,
        code: null,
        message: `could not normalize: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`,
        retryable: false,
      });
    }
  }

  return {
    name: SUPPLIER,

    searchPlaces(query: string): Promise<SupplierResult<Place[]>> {
      return lookup(() =>
        run({
          op: 'places',
          method: 'GET',
          url: withLang(`${DATA}/data/places?textQuery=${encodeURIComponent(query)}`),
          timeoutMs: TIMEOUTS.places,
          schema: placesResponse,
          normalize: normalizePlaces,
          meta: (v) => ({ count: v.length }),
        }),
      );
    },

    getPlace(placeId: string): Promise<SupplierResult<PlaceDetails>> {
      return lookup(() =>
        run({
          op: 'place',
          method: 'GET',
          url: withLang(`${DATA}/data/places/${encodeURIComponent(placeId)}`),
          timeoutMs: TIMEOUTS.places,
          schema: placeDetailsResponse,
          normalize: (body) => normalizePlaceDetails(placeId, body),
          meta: (v) => ({ types: v.types.slice(0, 3) }),
        }),
      );
    },

    searchAvailability(request: SearchRequest): Promise<SupplierResult<SearchResult>> {
      const fetchedAt = now();
      const where =
        'radiusM' in request.where
          ? { latitude: request.where.latitude, longitude: request.where.longitude, radius: request.where.radiusM }
          : request.where;
      return run({
        op: 'search',
        method: 'POST',
        url: `${DATA}/hotels/rates`,
        body: {
          ...where,
          checkin: request.checkIn,
          checkout: request.checkOut,
          occupancies: request.occupancies.map((o) => ({ adults: o.adults, children: o.childrenAges })),
          currency: request.currency,
          guestNationality: request.guestNationality,
          margin: request.marginPct,
          limit: request.maxHotels,
          maxRatesPerHotel: request.maxRatesPerHotel,
          includeHotelData: true,
        },
        timeoutMs: TIMEOUTS.search,
        schema: ratesResponse,
        normalize: (body) => normalizeRates(body, request.marginPct, fetchedAt),
        onSupplierError: (code) => (code === NO_AVAILABILITY ? { properties: [], offers: [] } : undefined),
        meta: (v) => ({ hotels: v.properties.length, offers: v.offers.length }),
      });
    },

    async getStaticFacts(supplierHotelIds: string[]): Promise<SupplierResult<StaticFacts[]>> {
      if (supplierHotelIds.length === 0) return { ok: true, value: [] };
      return run({
        op: 'facts',
        method: 'GET',
        url: `${DATA}/data/hotels?hotelIds=${supplierHotelIds.map(encodeURIComponent).join(',')}`,
        timeoutMs: TIMEOUTS.content,
        schema: hotelListResponse,
        normalize: normalizeStaticFacts,
        meta: (v) => ({ count: v.length }),
      });
    },

    getStaticContent(supplierHotelId: string): Promise<SupplierResult<PropertyDetails>> {
      return run({
        op: 'content',
        method: 'GET',
        url: withLang(`${DATA}/data/hotel?hotelId=${encodeURIComponent(supplierHotelId)}`),
        timeoutMs: TIMEOUTS.content,
        schema: hotelDetailsResponse,
        normalize: normalizeDetails,
      });
    },

    recheckRate(supplierOfferId: string): Promise<SupplierResult<RateCheck>> {
      return run({
        op: 'prebook',
        method: 'POST',
        url: `${BOOK}/rates/prebook`,
        body: { offerId: supplierOfferId, usePaymentSdk: true },
        timeoutMs: TIMEOUTS.prebook,
        schema: prebookResponse,
        normalize: (body) => normalizePrebook(body, now()),
      });
    },

    book(request: BookRequest): Promise<SupplierResult<SupplierBooking>> {
      // A test payment books without money. Only the sandbox may ever see one:
      // with a live key it is refused here, before any request is made.
      if (request.payment === 'sandbox_test' && !isSandboxKey(deps.apiKey)) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'supplier', status: null, code: null, message: 'a test payment needs a sandbox key', retryable: false },
        });
      }
      return run({
        op: 'book',
        method: 'POST',
        url: `${BOOK}/rates/book`,
        body: {
          prebookId: request.prebookId,
          holder: request.holder,
          // The guest paid the supplier's own form, and this id says so; or, in
          // the sandbox only, a test payment. Card data never passes through here.
          payment: request.payment === 'transaction_id' ? { method: 'TRANSACTION_ID', transactionId: request.transactionId } : { method: 'ACC_CREDIT_CARD' },
          // A special request is per room at the supplier (`guests[].remarks`,
          // kept and read back in the sandbox: book-with-remarks.json). The
          // guest typed one for the stay, so every room carries it.
          guests: request.guests.map((g, i) => ({ occupancyNumber: i + 1, ...g, ...(request.specialRequest ? { remarks: request.specialRequest } : {}) })),
        },
        timeoutMs: TIMEOUTS.book,
        schema: bookingResponse,
        normalize: normalizeBooking,
        meta: (v) => ({ status: v.statusRaw }),
      });
    },

    getBooking(supplierBookingId: string): Promise<SupplierResult<SupplierBooking>> {
      return run({
        op: 'booking',
        method: 'GET',
        url: `${BOOK}/bookings/${encodeURIComponent(supplierBookingId)}`,
        timeoutMs: TIMEOUTS.booking,
        schema: bookingResponse,
        normalize: normalizeBooking,
        meta: (v) => ({ status: v.statusRaw }),
      });
    },

    cancel(supplierBookingId: string): Promise<SupplierResult<CancelResult>> {
      return run({
        op: 'cancel',
        method: 'PUT',
        url: `${BOOK}/bookings/${encodeURIComponent(supplierBookingId)}`,
        timeoutMs: TIMEOUTS.booking,
        schema: cancelResponse,
        normalize: normalizeCancel,
        meta: (v) => ({ status: v.statusRaw }),
      });
    },
  };
}

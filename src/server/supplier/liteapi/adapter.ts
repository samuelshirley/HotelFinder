import type { z } from 'zod';

import type {
  BookRequest,
  CancelResult,
  Place,
  PropertyDetails,
  RateCheck,
  SearchRequest,
  SearchResult,
  SupplierAdapter,
  SupplierBooking,
  SupplierError,
  SupplierMeterEvent,
  SupplierResult,
} from '../types';
import { callLiteApi, type FetchLike } from './http';
import {
  normalizeBooking,
  normalizeCancel,
  normalizeDetails,
  normalizePlaces,
  normalizePrebook,
  normalizeRates,
  SUPPLIER,
} from './normalize';
import {
  bookingResponse,
  cancelResponse,
  errorBody,
  hotelDetailsResponse,
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

export type LiteApiDeps = {
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Called once per supplier call. A failing meter is reported, never thrown into the call. */
  meter?: (event: SupplierMeterEvent) => Promise<void> | void;
  onMeterError?: (err: unknown) => void;
};

export function createLiteApiAdapter(deps: LiteApiDeps): SupplierAdapter {
  const now = deps.now ?? (() => new Date());
  const onMeterError = deps.onMeterError ?? ((err) => console.error('[liteapi] usage meter failed', err));

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
    op: string;
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
        meta: { kind: error.kind, status: error.status, code: error.code },
      });
      return { ok: false, error };
    };
    const succeed = async (value: T, status: number): Promise<SupplierResult<T>> => {
      await record({ provider, latencyMs: http.latencyMs, success: true, errorMessage: null, meta: { status, ...spec.meta?.(value) } });
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
      return run({
        op: 'places',
        method: 'GET',
        url: `${DATA}/data/places?textQuery=${encodeURIComponent(query)}`,
        timeoutMs: TIMEOUTS.places,
        schema: placesResponse,
        normalize: normalizePlaces,
        meta: (v) => ({ count: v.length }),
      });
    },

    searchAvailability(request: SearchRequest): Promise<SupplierResult<SearchResult>> {
      const fetchedAt = now();
      return run({
        op: 'search',
        method: 'POST',
        url: `${DATA}/hotels/rates`,
        body: {
          ...request.where,
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

    getStaticContent(supplierHotelId: string): Promise<SupplierResult<PropertyDetails>> {
      return run({
        op: 'content',
        method: 'GET',
        url: `${DATA}/data/hotel?hotelId=${encodeURIComponent(supplierHotelId)}`,
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
      return run({
        op: 'book',
        method: 'POST',
        url: `${BOOK}/rates/book`,
        body: {
          prebookId: request.prebookId,
          holder: request.holder,
          // The only payment method the app uses: the guest paid the supplier's
          // own form, and this id says so. Card data never passes through here.
          payment: { method: 'TRANSACTION_ID', transactionId: request.transactionId },
          guests: request.guests.map((g, i) => ({ occupancyNumber: i + 1, ...g })),
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

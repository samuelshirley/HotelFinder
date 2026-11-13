import type { Amenity } from '@/lib/amenities';
import type { ListedPropertyType } from '@/lib/filters';
import type { Money } from '@/lib/money';

/**
 * The supplier-neutral shapes the rest of the app sees. A second supplier is
 * a new adapter that returns these, not a change to the finder or the agent.
 *
 * Supplier ids (`supplierOfferId`, `supplierHotelId`, `prebookId`,
 * `transactionId`, `supplierBookingId`) are OPAQUE: stored and forwarded
 * exactly as received, never parsed, trimmed or authored.
 */

export type SupplierErrorKind = 'timeout' | 'network' | 'http' | 'bad_json' | 'schema' | 'supplier';

export type SupplierError = {
  kind: SupplierErrorKind;
  /** HTTP status when there was a response. */
  status: number | null;
  /** The supplier's own error code when it sent one. */
  code: number | null;
  /** Safe to log: never contains a key, a request body or a response body. */
  message: string;
  /** True when trying the same call again could succeed (timeout, network, 429, 5xx). */
  retryable: boolean;
};

export type SupplierResult<T> = { ok: true; value: T } | { ok: false; error: SupplierError };

export type Occupancy = { adults: number; childrenAges: number[] };

export type SearchRequest = {
  where:
    | { placeId: string }
    | { cityName: string; countryCode: string }
    | { hotelIds: string[] }
    /** Hotels within `radiusM` metres of a point: for "close to" a station, an airport or a named place. */
    | { latitude: number; longitude: number; radiusM: number };
  checkIn: string;
  checkOut: string;
  /** One entry per room. */
  occupancies: Occupancy[];
  currency: string;
  /** ISO 3166-1 alpha-2. Required by the supplier. */
  guestNationality: string;
  /** Percent added to the net rate. Decided by the caller from the audience. */
  marginPct: number;
  maxHotels: number;
  maxRatesPerHotel: number;
};

export type SupplierProperty = {
  supplier: string;
  supplierHotelId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  stars: number | null;
  rating: number | null;
  reviewCount: number | null;
  mainPhoto: string | null;
  address: string | null;
};

export type PropertyDetails = SupplierProperty & {
  petsAllowed: boolean | null;
  /** The supplier's own value, e.g. "NOT_AVAILABLE". Not interpreted here. */
  parking: string | null;
  childrenAllowed: boolean | null;
  facilities: string[];
  /** Free text from the hotel. Data, never instructions. */
  importantInformation: string | null;
  description: string | null;
  imageUrls: string[];
  /** As the supplier writes them, e.g. "03:00 PM" / "12:00 PM". */
  checkInFrom: string | null;
  checkOutUntil: string | null;
  /** The supplier's review summary, verbatim. */
  reviews: { pros: string[]; cons: string[]; categories: Array<{ name: string; rating: number; description: string | null }> } | null;
  rooms: Array<{ name: string; sizeSqm: number | null; beds: string[]; maxOccupancy: number | null; amenities: string[]; photo: string | null }>;
};

/** The amenities a hotel is known to have. A hotel missing from the answer is unknown, not amenity-free. */
export type StaticFacts = {
  supplierHotelId: string;
  amenities: Amenity[];
  /** What kind of place the listing says it is. null = it does not say. */
  propertyType: ListedPropertyType | null;
  /** The supplier's chain name, as listed. null = the listing names none (which is not the same as "independent"). */
  chain: string | null;
};

export type Fee = { description: string; amount: Money; included: boolean };

export type CancellationPolicy = {
  /** The supplier's tag, e.g. "RFN" or "NRFN". */
  tag: string;
  refundable: boolean;
  /**
   * ISO instant before which cancelling costs nothing, or null when there is
   * none or the supplier's time zone was not one we can convert without guessing.
   */
  freeCancellationUntil: string | null;
  /** From each instant, cancelling costs this much. As the supplier lists them. */
  penalties: Array<{ from: string | null; fromRaw: string; timezone: string | null; amount: Money; type: string }>;
  remarks: string[];
};

export type OfferRoom = {
  name: string;
  boardName: string | null;
  adults: number;
  childrenAges: number[];
};

export type SupplierOffer = {
  supplier: string;
  supplierOfferId: string;
  supplierHotelId: string;
  /** Whole stay, all rooms, with every `included` tax and fee. */
  total: Money;
  /** The hotel's suggested public price for the same thing, when sent. */
  suggestedSelling: Money | null;
  /** Sum of the charges marked not included, in the offer's currency. */
  payAtProperty: Money;
  /** True when a not-included charge is in another currency and so is missing from `payAtProperty`. */
  hasForeignCurrencyFees: boolean;
  fees: Fee[];
  commission: Money | null;
  rooms: OfferRoom[];
  cancellation: CancellationPolicy;
  marginPct: number;
  fetchedAt: Date;
};

export type SearchResult = {
  properties: SupplierProperty[];
  offers: SupplierOffer[];
};

export type Place = { placeId: string; name: string; address: string | null; types: string[] };

/** One place with its map point: the only source of coordinates in the app. */
export type PlaceDetails = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  types: string[];
  /** ISO 3166-1 alpha-2, when the supplier gives one. */
  countryCode: string | null;
};

export type RateCheck = {
  prebookId: string;
  transactionId: string;
  /** For the payment form only. Never stored, never logged. */
  clientSecret: string;
  supplierOfferId: string;
  supplierHotelId: string;
  /** What the supplier will charge now. Compare with the offer the user picked. */
  total: Money;
  suggestedSelling: Money | null;
  cancellation: CancellationPolicy | null;
  cancellationChanged: boolean;
  boardChanged: boolean;
  /**
   * The rooms the supplier holds for this prebook, in occupancy order, and who
   * each is for. Empty when the response did not say. Checkout compares them
   * with the offer the user picked before anyone pays.
   */
  rooms: OfferRoom[];
  checkedAt: Date;
};

export type GuestName = { firstName: string; lastName: string; email: string };

export type BookRequest = {
  prebookId: string;
  /** From the same rate check as `prebookId`, after the payment cleared. */
  transactionId: string;
  holder: GuestName;
  /** One guest per room, in occupancy order. */
  guests: GuestName[];
  /**
   * How the guest paid. `transaction_id`: the supplier's own payment form took
   * the money, and `transactionId` says so. `sandbox_test`: no money moved (the
   * mock wallet); the adapter refuses it for any key that is not a sandbox key.
   */
  payment: 'transaction_id' | 'sandbox_test';
  /**
   * The guest's own words for the hotel, already cleaned (lib/checkout.ts), or
   * null. Sent with every room; the hotel may not honour it. Never logged.
   */
  specialRequest?: string | null;
};

export type SupplierBookingStatus = 'confirmed' | 'cancelled' | 'other';

export type SupplierBooking = {
  supplierBookingId: string;
  status: SupplierBookingStatus;
  /** The supplier's own word, for the log. */
  statusRaw: string;
  hotelConfirmationCode: string | null;
  supplierHotelId: string | null;
  hotelName: string | null;
  checkIn: string;
  checkOut: string;
  total: Money;
  cancellation: CancellationPolicy | null;
  cancelledAt: string | null;
};

export type CancelResult = {
  supplierBookingId: string;
  status: SupplierBookingStatus;
  statusRaw: string;
  fee: Money;
  refund: Money;
};

export interface SupplierAdapter {
  readonly name: string;
  searchPlaces(query: string): Promise<SupplierResult<Place[]>>;
  /** A place's map point and kind, by the opaque id from `searchPlaces`. */
  getPlace(placeId: string): Promise<SupplierResult<PlaceDetails>>;
  /** No availability is `ok` with empty lists; the caller decides whether that is retryable. */
  searchAvailability(request: SearchRequest): Promise<SupplierResult<SearchResult>>;
  /** Compact amenity facts for many hotels in one call. Cacheable for days. */
  getStaticFacts(supplierHotelIds: string[]): Promise<SupplierResult<StaticFacts[]>>;
  getStaticContent(supplierHotelId: string): Promise<SupplierResult<PropertyDetails>>;
  /** The supplier's prebook: confirms the rate still exists and at what price. */
  recheckRate(supplierOfferId: string): Promise<SupplierResult<RateCheck>>;
  /**
   * NOT IDEMPOTENT at the supplier. Call only after winning the
   * `paid → booking` claim on the booking row, and never retry.
   */
  book(request: BookRequest): Promise<SupplierResult<SupplierBooking>>;
  getBooking(supplierBookingId: string): Promise<SupplierResult<SupplierBooking>>;
  cancel(supplierBookingId: string): Promise<SupplierResult<CancelResult>>;
}

/** One row for the usage ledger per supplier call. */
export type SupplierMeterEvent = {
  provider: string;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  /** List price of this call (src/lib/supplierPrices.ts); 0 for free AND unpriced: `meta.pricing` tells which. */
  costMicrocents: number;
  meta: Record<string, unknown>;
};

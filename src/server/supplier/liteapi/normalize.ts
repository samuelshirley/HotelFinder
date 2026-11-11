import type { z } from 'zod';

import { sumMoney, toMoney, type Money } from '@/lib/money';
import { amenitiesFromFacilityIds } from './amenities';
import type {
  CancellationPolicy,
  CancelResult,
  Fee,
  Place,
  PlaceDetails,
  PropertyDetails,
  RateCheck,
  SearchResult,
  StaticFacts,
  SupplierBooking,
  SupplierBookingStatus,
  SupplierOffer,
  SupplierProperty,
} from '../types';
import type {
  bookingResponse,
  cancelResponse,
  hotelDetailsResponse,
  hotelListResponse,
  placeDetailsResponse,
  placesResponse,
  prebookResponse,
  RatesResponse,
  RawCancellation,
} from './schemas';

/** Pure: a validated LiteAPI body in, the app's own shapes out. No I/O, no clock. */

export const SUPPLIER = 'liteapi';

/**
 * "2026-11-25 09:59:00" + "GMT" → "2026-11-25T09:59:00.000Z". Returns null for
 * any time zone other than GMT/UTC rather than guessing an offset.
 */
export function supplierTimeToIso(raw: string, timezone: string | null | undefined): string | null {
  if (!timezone || !/^(GMT|UTC)$/i.test(timezone.trim())) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeCancellation(raw: RawCancellation, fallbackCurrency: string): CancellationPolicy {
  const refundable = raw.refundableTag === 'RFN';
  const penalties = (raw.cancelPolicyInfos ?? []).map((info) => ({
    from: supplierTimeToIso(info.cancelTime, info.timezone),
    fromRaw: info.cancelTime,
    timezone: info.timezone ?? null,
    amount: toMoney(info.amount, info.currency ?? fallbackCurrency),
    type: info.type ?? 'amount',
  }));
  // Free until the first moment cancelling costs something. Unknown if any
  // charging penalty has a time we could not convert.
  const charging = penalties.filter((p) => p.amount.amountMinor > 0);
  let freeCancellationUntil: string | null = null;
  if (refundable && charging.length > 0 && charging.every((p) => p.from !== null)) {
    freeCancellationUntil = charging.map((p) => p.from as string).sort()[0];
  }
  return {
    tag: raw.refundableTag,
    refundable,
    freeCancellationUntil,
    penalties,
    remarks: raw.hotelRemarks ?? [],
  };
}

/** Across rooms: refundable only if every room is, free only until the earliest deadline. */
function combineCancellations(policies: CancellationPolicy[]): CancellationPolicy {
  if (policies.length === 1) return policies[0];
  const refundable = policies.every((p) => p.refundable);
  const deadlines = policies.map((p) => p.freeCancellationUntil);
  return {
    tag: refundable ? policies[0].tag : (policies.find((p) => !p.refundable)?.tag ?? policies[0].tag),
    refundable,
    freeCancellationUntil:
      refundable && deadlines.every((d) => d !== null) ? (deadlines as string[]).sort()[0] : null,
    penalties: policies.flatMap((p) => p.penalties),
    remarks: [...new Set(policies.flatMap((p) => p.remarks))],
  };
}

export function normalizeRates(body: RatesResponse, marginPct: number, fetchedAt: Date): SearchResult {
  const properties: SupplierProperty[] = (body.hotels ?? []).map((h) => ({
    supplier: SUPPLIER,
    supplierHotelId: h.id,
    name: h.name,
    latitude: h.latitude ?? null,
    longitude: h.longitude ?? null,
    stars: h.stars ?? null,
    rating: h.rating ?? null,
    reviewCount: h.review_count ?? null,
    mainPhoto: h.main_photo ?? null,
    address: h.address ?? null,
  }));

  const offers: SupplierOffer[] = [];
  for (const hotel of body.data) {
    for (const rt of hotel.roomTypes) {
      const currency = rt.offerRetailRate.currency.toUpperCase();
      const fees: Fee[] = rt.rates.flatMap((r) =>
        (r.retailRate.taxesAndFees ?? []).map((f) => ({
          description: f.description ?? '',
          amount: toMoney(f.amount, f.currency ?? currency),
          included: f.included,
        })),
      );
      const excluded = fees.filter((f) => !f.included);
      const sameCurrency = excluded.filter((f) => f.amount.currency === currency);
      const commissions: Money[] = rt.rates.flatMap((r) => (r.commission ?? []).map((c) => toMoney(c.amount, c.currency)));
      offers.push({
        supplier: SUPPLIER,
        supplierOfferId: rt.offerId,
        supplierHotelId: hotel.hotelId,
        total: toMoney(rt.offerRetailRate.amount, currency),
        suggestedSelling: rt.suggestedSellingPrice
          ? toMoney(rt.suggestedSellingPrice.amount, rt.suggestedSellingPrice.currency)
          : null,
        payAtProperty: sumMoney(currency, sameCurrency.map((f) => f.amount)),
        hasForeignCurrencyFees: sameCurrency.length !== excluded.length,
        fees,
        commission:
          commissions.length > 0 && commissions.every((c) => c.currency === currency)
            ? sumMoney(currency, commissions)
            : null,
        rooms: [...rt.rates]
          .sort((a, b) => a.occupancyNumber - b.occupancyNumber)
          .map((r) => ({
            name: r.name,
            boardName: r.boardName ?? null,
            adults: r.adultCount,
            childrenAges: r.childrenAges ?? [],
          })),
        cancellation: combineCancellations(rt.rates.map((r) => normalizeCancellation(r.cancellationPolicies, currency))),
        marginPct,
        fetchedAt,
      });
    }
  }
  return { properties, offers };
}

export function normalizePlaces(body: z.infer<typeof placesResponse>): Place[] {
  return body.data.map((p) => ({
    placeId: p.placeId,
    name: p.displayName,
    address: p.formattedAddress ?? null,
    types: p.types ?? [],
  }));
}

/** The id is the one we asked for: the details body does not repeat it. */
export function normalizePlaceDetails(placeId: string, body: z.infer<typeof placeDetailsResponse>): PlaceDetails {
  const d = body.data;
  return {
    placeId,
    name: d.displayName,
    latitude: d.location.latitude,
    longitude: d.location.longitude,
    types: d.types ?? [],
    countryCode: d.countryCode && /^[A-Z]{2}$/.test(d.countryCode) ? d.countryCode : null,
  };
}

export function normalizeStaticFacts(body: z.infer<typeof hotelListResponse>): StaticFacts[] {
  return body.data.map((h) => ({ supplierHotelId: h.id, amenities: amenitiesFromFacilityIds(h.facilityIds ?? []) }));
}

export function normalizeDetails(body: z.infer<typeof hotelDetailsResponse>): PropertyDetails {
  const d = body.data;
  return {
    supplier: SUPPLIER,
    supplierHotelId: d.id,
    name: d.name,
    latitude: d.location?.latitude ?? null,
    longitude: d.location?.longitude ?? null,
    stars: d.starRating ?? null,
    rating: d.rating ?? null,
    reviewCount: d.reviewCount ?? null,
    mainPhoto: d.main_photo ?? null,
    address: d.address ?? null,
    petsAllowed: d.petsAllowed ?? null,
    parking: d.parking ?? null,
    childrenAllowed: d.childAllowed ?? null,
    facilities: d.hotelFacilities ?? [],
    importantInformation: d.hotelImportantInformation ?? null,
    description: d.hotelDescription ?? null,
    imageUrls: (d.hotelImages ?? []).map((i) => i.url),
    checkInFrom: d.checkinCheckoutTimes?.checkin_start || null,
    checkOutUntil: d.checkinCheckoutTimes?.checkout || null,
    reviews: d.sentiment_analysis
      ? {
          pros: d.sentiment_analysis.pros ?? [],
          cons: d.sentiment_analysis.cons ?? [],
          categories: (d.sentiment_analysis.categories ?? []).flatMap((c) => (typeof c.rating === 'number' ? [{ name: c.name, rating: c.rating, description: c.description ?? null }] : [])),
        }
      : null,
    rooms: (d.rooms ?? []).flatMap((r) => {
      if (!r.roomName) return [];
      const size = Number(r.roomSizeSquare);
      const occupancy = Number(r.maxOccupancy);
      const sqm = Number.isFinite(size) && size > 0 ? (r.roomSizeUnit === 'sqft' ? Math.round(size * 0.092903) : size) : null;
      return [
        {
          name: r.roomName,
          sizeSqm: sqm,
          beds: (r.bedTypes ?? []).flatMap((b) => (b.bedType ? [`${b.quantity && b.quantity > 1 ? `${b.quantity} × ` : ''}${b.bedType.toLowerCase()}`] : [])),
          maxOccupancy: Number.isFinite(occupancy) && occupancy > 0 ? occupancy : null,
          amenities: (r.roomAmenities ?? []).map((a) => a.name),
          photo: r.photos?.[0]?.url ?? null,
        },
      ];
    }),
  };
}

export function normalizePrebook(body: z.infer<typeof prebookResponse>, checkedAt: Date): RateCheck {
  const d = body.data;
  const currency = d.currency.toUpperCase();
  const policies = (d.roomTypes ?? []).flatMap((rt) =>
    rt.rates.map((r) => normalizeCancellation(r.cancellationPolicies, currency)),
  );
  return {
    prebookId: d.prebookId,
    transactionId: d.transactionId,
    clientSecret: d.secretKey,
    supplierOfferId: d.offerId,
    supplierHotelId: d.hotelId,
    total: toMoney(d.price, currency),
    suggestedSelling: d.suggestedSellingPrice != null ? toMoney(d.suggestedSellingPrice, currency) : null,
    cancellation: policies.length > 0 ? combineCancellations(policies) : null,
    cancellationChanged: d.cancellationChanged ?? false,
    boardChanged: d.boardChanged ?? false,
    checkedAt,
  };
}

export function bookingStatus(raw: string): SupplierBookingStatus {
  const s = raw.trim().toUpperCase();
  if (s === 'CONFIRMED') return 'confirmed';
  // The sandbox answers a non-refundable cancel with CANCELLED_WITH_CHARGES (seen
  // live 2026-11-11, booking 9OMqobucP): cancelled, with the fee kept. Any
  // CANCELLED* is cancelled; the money is in the fee and refund fields.
  if (/^CANCEL+ED(_|$)/.test(s)) return 'cancelled';
  return 'other';
}

export function normalizeBooking(body: z.infer<typeof bookingResponse>): SupplierBooking {
  const d = body.data;
  const currency = d.currency.toUpperCase();
  return {
    supplierBookingId: d.bookingId,
    status: bookingStatus(d.status),
    statusRaw: d.status,
    hotelConfirmationCode: d.hotelConfirmationCode || null,
    supplierHotelId: d.hotel?.hotelId ?? null,
    hotelName: d.hotel?.name ?? null,
    checkIn: d.checkin,
    checkOut: d.checkout,
    total: toMoney(d.price, currency),
    cancellation: d.cancellationPolicies ? normalizeCancellation(d.cancellationPolicies, currency) : null,
    cancelledAt: d.cancelledAt || null,
  };
}

export function normalizeCancel(body: z.infer<typeof cancelResponse>): CancelResult {
  const d = body.data;
  return {
    supplierBookingId: d.bookingId,
    status: bookingStatus(d.status),
    statusRaw: d.status,
    fee: toMoney(d.cancellation_fee, d.currency),
    refund: toMoney(d.refund_amount, d.currency),
  };
}

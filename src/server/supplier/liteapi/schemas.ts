import { z } from 'zod';

/**
 * What we REQUIRE of a LiteAPI response. Loose where the supplier adds fields
 * (everything is passthrough), strict on the fields the app shows a user or
 * sends back: a missing offerId or a non-numeric price is a schema error, not
 * a default. Shapes are taken from the recorded sandbox responses in
 * __fixtures__/, not from the docs.
 */

const amount = z.number().finite();
const money = z.object({ amount, currency: z.string().min(3).max(3) }).passthrough();

export const errorBody = z
  .object({
    error: z
      .object({ code: z.number().int().optional(), message: z.string().optional(), description: z.string().optional() })
      .passthrough(),
  })
  .passthrough();

const taxOrFee = z
  .object({
    included: z.boolean(),
    description: z.string().nullish(),
    amount,
    currency: z.string().nullish(),
  })
  .passthrough();

export const cancellationPolicies = z
  .object({
    refundableTag: z.string().min(1),
    cancelPolicyInfos: z
      .array(
        z
          .object({
            cancelTime: z.string().min(1),
            amount,
            currency: z.string().nullish(),
            type: z.string().nullish(),
            timezone: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
    hotelRemarks: z.array(z.string()).nullish(),
  })
  .passthrough();

const rate = z
  .object({
    occupancyNumber: z.number().int(),
    name: z.string(),
    boardName: z.string().nullish(),
    adultCount: z.number().int(),
    childrenAges: z.array(z.number().int()).nullish(),
    retailRate: z
      .object({ total: z.array(money).min(1), taxesAndFees: z.array(taxOrFee).nullish() })
      .passthrough(),
    cancellationPolicies,
    commission: z.array(money).nullish(),
  })
  .passthrough();

const roomType = z
  .object({
    offerId: z.string().min(1),
    rates: z.array(rate).min(1),
    offerRetailRate: money,
    suggestedSellingPrice: money.nullish(),
  })
  .passthrough();

const hotelBrief = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    main_photo: z.string().nullish(),
    address: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    rating: z.number().nullish(),
    stars: z.number().nullish(),
    review_count: z.number().nullish(),
  })
  .passthrough();

export const ratesResponse = z
  .object({
    data: z.array(z.object({ hotelId: z.string().min(1), roomTypes: z.array(roomType) }).passthrough()),
    hotels: z.array(hotelBrief).nullish(),
  })
  .passthrough();

export const placesResponse = z
  .object({
    data: z.array(
      z
        .object({
          placeId: z.string().min(1),
          displayName: z.string(),
          formattedAddress: z.string().nullish(),
          types: z.array(z.string()).nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const placeDetailsResponse = z
  .object({
    data: z
      .object({
        displayName: z.string(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
        types: z.array(z.string()).nullish(),
        countryCode: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export const hotelListResponse = z
  .object({
    data: z.array(z.object({ id: z.string().min(1), facilityIds: z.array(z.number().int()).nullish() }).passthrough()),
  })
  .passthrough();

export const hotelDetailsResponse = z
  .object({
    data: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        hotelDescription: z.string().nullish(),
        hotelImportantInformation: z.string().nullish(),
        main_photo: z.string().nullish(),
        address: z.string().nullish(),
        starRating: z.number().nullish(),
        rating: z.number().nullish(),
        reviewCount: z.number().nullish(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).passthrough().nullish(),
        petsAllowed: z.boolean().nullish(),
        childAllowed: z.boolean().nullish(),
        parking: z.string().nullish(),
        hotelFacilities: z.array(z.string()).nullish(),
        hotelImages: z.array(z.object({ url: z.string() }).passthrough()).nullish(),
        checkinCheckoutTimes: z.object({ checkin_start: z.string().nullish(), checkout: z.string().nullish() }).passthrough().nullish(),
        // The supplier's own review summary: data, shown verbatim, never interpreted.
        sentiment_analysis: z
          .object({
            pros: z.array(z.string()).nullish(),
            cons: z.array(z.string()).nullish(),
            categories: z.array(z.object({ name: z.string(), rating: z.number().nullish(), description: z.string().nullish() }).passthrough()).nullish(),
          })
          .passthrough()
          .nullish()
          .catch(null),
        rooms: z
          .array(
            z
              .object({
                roomName: z.string().nullish(),
                roomSizeSquare: z.union([z.string(), z.number()]).nullish(),
                roomSizeUnit: z.string().nullish(),
                maxOccupancy: z.union([z.string(), z.number()]).nullish(),
                bedTypes: z.array(z.object({ quantity: z.number().nullish(), bedType: z.string().nullish() }).passthrough()).nullish(),
                roomAmenities: z.array(z.object({ name: z.string() }).passthrough()).nullish(),
                photos: z.array(z.object({ url: z.string() }).passthrough()).nullish(),
              })
              .passthrough(),
          )
          .nullish()
          .catch(null),
      })
      .passthrough(),
  })
  .passthrough();

export const prebookResponse = z
  .object({
    data: z
      .object({
        prebookId: z.string().min(1),
        offerId: z.string().min(1),
        hotelId: z.string().min(1),
        currency: z.string().min(3).max(3),
        price: amount,
        suggestedSellingPrice: amount.nullish(),
        transactionId: z.string().min(1),
        secretKey: z.string().min(1),
        cancellationChanged: z.boolean().nullish(),
        boardChanged: z.boolean().nullish(),
        roomTypes: z
          .array(z.object({ rates: z.array(z.object({ cancellationPolicies }).passthrough()).min(1) }).passthrough())
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export const bookingResponse = z
  .object({
    data: z
      .object({
        bookingId: z.string().min(1),
        status: z.string().min(1),
        hotelConfirmationCode: z.string().nullish(),
        checkin: z.string().min(1),
        checkout: z.string().min(1),
        hotel: z.object({ hotelId: z.string().nullish(), name: z.string().nullish() }).passthrough().nullish(),
        price: amount,
        currency: z.string().min(3).max(3),
        cancellationPolicies: cancellationPolicies.nullish(),
        cancelledAt: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export const cancelResponse = z
  .object({
    data: z
      .object({
        bookingId: z.string().min(1),
        status: z.string().min(1),
        cancellation_fee: amount,
        refund_amount: amount,
        currency: z.string().min(3).max(3),
      })
      .passthrough(),
  })
  .passthrough();

export type RatesResponse = z.infer<typeof ratesResponse>;
export type RawCancellation = z.infer<typeof cancellationPolicies>;

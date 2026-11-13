/**
 * Strict shapes of every API answer. Written here rather than imported: the
 * app types its answers with TypeScript only (SessionView, BookingView, …),
 * and the server-side modules that define them import 'server-only'. Strict
 * objects also hold invariant 6 (supplier ids are opaque): a supplier id,
 * prebook id or transaction id leaking into an answer is an unknown key.
 */
import { z } from 'zod';

import { ERROR_COPY } from './copy';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const minor = z.number().int().nonnegative();
const errorCode = z.enum(Object.keys(ERROR_COPY) as [string, ...string[]]);

/** Every error answer: one known code, and a `ref` only (and always) on a 500. */
export const errorBody = z.object({ error: errorCode, ref: z.string().regex(/^[0-9a-f]{8}$/).optional() }).strict();

export const placesBody = z
  .object({
    places: z
      .array(
        z
          .object({
            placeId: z.string().min(1),
            label: z.string().min(1),
            name: z.string().min(1),
            where: z.string().min(1).nullable(),
            kind: z.string().min(1),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export const sessionIdBody = z.object({ sessionId: uuid }).strict();
export const tripsBody = z
  .object({
    trips: z.array(z.object({ id: uuid, status: z.enum(['onboarding', 'active', 'closed']), destination: z.string().min(1), checkIn: isoDate, checkOut: isoDate }).strict()),
  })
  .strict();

const penalty = z.object({ from: z.string().nullable(), amountMinor: minor, currency }).strict();
const fee = z.object({ description: z.string().min(1), amountMinor: minor, currency, included: z.boolean() }).strict();

const offer = z
  .object({
    id: uuid,
    currency,
    totalMinor: z.number().int().positive(),
    payAtPropertyMinor: minor,
    suggestedSellingMinor: minor.nullable(),
    audience: z.enum(['public', 'member']),
    /** One room's name, or "2 rooms: …" when the price is for several (docs/finder.md, "Room splits"). */
    roomName: z.string().nullable(),
    rooms: z.number().int().min(1).max(6),
    boardName: z.string().nullable(),
    refundable: z.boolean(),
    freeCancellationUntil: z.string().nullable(),
    penalties: z.array(penalty),
    fees: z.array(fee),
    fetchedAt: isoTime,
    expiresAt: isoTime,
  })
  .strict();

export const shortlistRow = z
  .object({
    entryId: uuid,
    rank: z.number().int().positive(),
    source: z.enum(['finder', 'user_named']),
    reason: z.record(z.unknown()).nullable(),
    property: z
      .object({
        id: uuid,
        name: z.string().min(1),
        photo: z.string().url().nullable(),
        address: z.string().nullable(),
        stars: z.number().min(0).max(5).nullable(),
        rating: z.number().min(0).max(10).nullable(),
        reviewCount: z.number().int().nonnegative().nullable(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
      })
      .strict(),
    offer: offer.nullable(),
  })
  .strict();

const message = z
  .object({
    id: uuid,
    role: z.enum(['user', 'assistant']),
    kind: z.enum(['user', 'ai', 'line', 'form_question', 'form_answer', 'otp_form', 'guest_form', 'payment_form', 'receipt', 'error']),
    content: z.string(),
    meta: z.record(z.unknown()).nullable(),
    createdAt: isoTime,
  })
  .strict();

const priorityKey = z.enum(['cheapest', 'closest', 'nicest']);
const propertyType = z.enum(['hotel', 'aparthotel', 'apartment', 'hostel', 'bed_and_breakfast', 'guest_house', 'holiday_home']);

export const sessionView = z
  .object({
    session: z
      .object({
        id: uuid,
        status: z.enum(['onboarding', 'active', 'closed']),
        priorities: z.array(priorityKey).nullable(),
        guestNationality: z.string().regex(/^[A-Z]{2}$/).nullable(),
        nationalitySource: z.enum(['user', 'saved', 'browser', 'ip', 'destination']).nullable(),
        currency,
        signedIn: z.boolean(),
        audience: z.enum(['public', 'member']),
      })
      .strict(),
    pending: z
      .object({
        destination: z.string().nullable(),
        guests: z.object({ adults: z.number().int(), childrenAges: z.array(z.number().int()), rooms: z.number().int() }).strict().nullable(),
        pets: z.boolean(),
        priorities: z.array(priorityKey).nullable(),
        nearLabel: z.string().min(1),
      })
      .strict()
      .nullable(),
    stay: z
      .object({
        id: uuid,
        destination: z.string().min(1),
        checkIn: isoDate,
        checkOut: isoDate,
        adults: z.number().int().min(1).max(12),
        childrenAges: z.array(z.number().int().min(0).max(17)),
        /** null = "Best price": the finder chooses the rooms. */
        rooms: z.number().int().min(1).max(6).nullable(),
        priceCapMinor: z.number().int().positive().nullable(),
        mustHaves: z.array(z.string()),
        filters: z
          .object({
            minStars: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable(),
            minRating: z.union([z.literal(7), z.literal(8), z.literal(9)]).nullable(),
            propertyTypes: z.array(propertyType),
            chains: z.array(z.string().min(1)),
          })
          .strict(),
        filterOptions: z
          .object({
            propertyTypes: z.array(z.object({ type: propertyType, count: z.number().int().positive() }).strict()),
            chains: z.array(z.object({ chain: z.string().min(1), count: z.number().int().positive() }).strict()),
            silent: z.object({ propertyType: z.number().int().nonnegative(), chain: z.number().int().nonnegative() }).strict(),
          })
          .strict(),
        excludedCount: z.number().int().nonnegative(),
        nearLabel: z.string().min(1),
        nearIsNamed: z.boolean(),
        anchor: z.object({ latitude: z.number(), longitude: z.number(), label: z.string().min(1) }).strict().nullable(),
      })
      .strict()
      .nullable(),
    messages: z.array(message),
    shortlist: z.array(shortlistRow),
    /** "Show all N hotels": every hotel that fits (top picks included), and how many lie after the picks. */
    fullList: z.object({ total: z.number().int().nonnegative(), more: z.number().int().nonnegative(), pageSize: z.number().int().positive() }).strict(),
  })
  .strict();
export type SessionViewBody = z.infer<typeof sessionView>;

export const turnsBody = z
  .object({
    turns: z.array(
      z
        .object({ id: uuid, idempotencyKey: z.string().min(8), status: z.enum(['queued', 'running', 'done', 'error']), errorCode: errorCode.nullable(), finishedAt: isoTime.nullable() })
        .strict(),
    ),
  })
  .strict();

export const propertyDetailsBody = z
  .object({
    id: uuid,
    name: z.string().min(1),
    address: z.string().nullable(),
    stars: z.number().nullable(),
    rating: z.number().nullable(),
    reviewCount: z.number().int().nullable(),
    description: z.string().nullable(),
    importantInformation: z.string().nullable(),
    facilities: z.array(z.string()).max(40),
    imageUrls: z.array(z.string().url()).max(12),
    petsAllowed: z.boolean().nullable(),
    parking: z.string().nullable(),
    childrenAllowed: z.boolean().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    checkInFrom: z.string().nullable(),
    checkOutUntil: z.string().nullable(),
    reviews: z
      .object({
        pros: z.array(z.string()),
        cons: z.array(z.string()),
        categories: z.array(z.object({ name: z.string(), rating: z.number().min(0).max(10), description: z.string().nullable().optional() }).passthrough()),
      })
      .strict()
      .nullable(),
    rooms: z.array(z.record(z.unknown())).max(40),
    allFacilities: z.array(z.string()),
    /** The amenity list the chat answers from; null when the listing has none. */
    amenities: z.array(z.string()).nullable(),
  })
  .strict();

export const ratesBody = z
  .object({
    rates: z.array(
      z
        .object({
          offerId: uuid,
          roomName: z.string().nullable(),
          boardName: z.string().nullable(),
          refundable: z.boolean(),
          freeCancellationUntil: z.string().nullable(),
          penalties: z.array(penalty),
          fees: z.array(fee),
          currency,
          totalMinor: z.number().int().positive(),
          payAtPropertyMinor: minor,
        })
        .strict(),
    ),
  })
  .strict();

export const bookingIdBody = z.object({ bookingId: uuid }).strict();

const bookingStatus = z.enum(['prebooked', 'payment_pending', 'paid', 'booking', 'confirmed', 'failed', 'cancelled', 'freezing', 'frozen', 'keeping', 'releasing']);
const charge = z.object({ description: z.string().min(1), amountMinor: minor, currency }).strict();
export const bookingView = z
  .object({
    id: uuid,
    sessionId: uuid.nullable(),
    status: bookingStatus,
    hotelName: z.string().nullable(),
    roomName: z.string().nullable(),
    boardName: z.string().nullable(),
    checkIn: isoDate.nullable(),
    checkOut: isoDate.nullable(),
    adults: z.number().int().nullable(),
    childrenAges: z.array(z.number().int()),
    rooms: z.number().int().nullable(),
    currency,
    totalMinor: z.number().int().positive(),
    quotedTotalMinor: minor.nullable(),
    priceChanged: z.boolean(),
    payAtPropertyMinor: minor,
    /** Each charge the hotel collects, as the supplier names it; null on bookings from before they were kept. */
    payAtPropertyFees: z.array(charge).nullable(),
    specialRequest: z.string().max(500).nullable(),
    refundable: z.boolean().nullable(),
    freeCancellationUntil: z.string().nullable(),
    checkedAt: isoTime,
    priceCheckStale: z.boolean(),
    reference: z.string().nullable(),
    hotelConfirmationCode: z.string().nullable(),
    holder: z.object({ firstName: z.string(), lastName: z.string().nullable(), email: z.string().nullable() }).strict().nullable(),
    paidWith: z.enum(['apple_pay', 'google_pay']).nullable(),
    testPayment: z.boolean().nullable(),
    failureCode: z.string().nullable(),
    refundMinor: minor.nullable(),
    cancelFeeMinor: minor.nullable(),
    offerId: uuid.nullable(),
    /** Deal Freeze (docs/deal-freeze.md). */
    freezeOffer: z.object({ until: isoTime, reminderAt: isoTime }).strict().nullable(),
    frozenUntil: isoTime.nullable(),
    freezeReminderDueAt: isoTime.nullable(),
    freezeReminderSentAt: isoTime.nullable(),
    releasedBy: z.enum(['guest', 'expiry', 'terms']).nullable(),
  })
  .strict();
export type BookingViewBody = z.infer<typeof bookingView>;

const holder = z.object({ firstName: z.string(), lastName: z.string() }).strict().nullable();
export const bookingPageBody = z
  .object({ booking: bookingView, me: z.object({ email: z.string().email() }).strict().nullable(), lastHolder: holder, payment: z.enum(['test', 'none']), mail: z.boolean() })
  .strict();
export const bookingBody = z.object({ booking: bookingView }).strict();
export const bookingsBody = z
  .object({
    bookings: z.array(
      z.object({ id: uuid, status: z.enum(['confirmed', 'cancelled', 'booking', 'frozen', 'keeping', 'releasing', 'freezing']), hotelName: z.string().nullable(), checkIn: isoDate.nullable(), checkOut: isoDate.nullable() }).strict(),
    ),
  })
  .strict();
export const meBody = z.object({ user: z.object({ email: z.string().email() }).strict().nullable(), lastHolder: holder }).strict();
export const codeSentBody = z.object({ sent: z.literal(true), devCode: z.string().regex(/^\d{6}$/).optional() }).strict();
export const signedInBody = z.object({ signedIn: z.literal(true) }).strict();
/** Signed in from a search ("Sign in to see price"): that search comes back ranked at member prices. */
export const signedInWithViewBody = z.object({ signedIn: z.literal(true), view: sessionView }).strict();
export const signedOutBody = z.object({ signedIn: z.literal(false) }).strict();
export const okBody = z.object({ ok: z.literal(true) }).strict();
export const healthBody = z
  .object({ ok: z.boolean(), missingTables: z.array(z.string()), missingColumns: z.array(z.string()), pendingMigrations: z.number().int().nonnegative().nullable() })
  .strict();
export const exampleBody = z
  .object({
    caption: z.string().min(1),
    name: z.string().min(1),
    total: z.string().min(1),
    nightsText: z.string().regex(/^\d+ nights?$/),
    facts: z.string().min(1),
    reason: z.string().min(1),
    photo: z.string().url().nullable(),
  })
  .strict();

/** One Server-Sent Events frame of a chat turn. */
export const turnEvent = z.object({ type: z.string().min(1) }).passthrough();

/** One page of "Show all N hotels" (GET api/session/[id]/hotels): rows in the session view's row shape. */
export const fullListBody = z
  .object({ more: z.number().int().nonnegative(), page: z.number().int().min(1), pageSize: z.number().int().positive(), rows: z.array(shortlistRow) })
  .strict();

/** The saved list (GET/POST api/saved): never a current price, only the last one found (docs/saved.md). */
export const savedBody = z
  .object({
    saved: z.array(
      z
        .object({
          propertyId: uuid,
          name: z.string().min(1),
          photo: z.string().url().nullable(),
          address: z.string().nullable(),
          stars: z.number().min(0).max(5).nullable(),
          rating: z.number().min(0).max(10).nullable(),
          savedAt: isoTime,
          sessionId: uuid.nullable(),
          lastFound: z.object({ totalMinor: z.number().int().positive(), currency, checkIn: isoDate, checkOut: isoDate, fetchedAt: isoTime }).strict().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** The Deal Freeze sweep's report (GET api/freeze/sweep). */
export const sweepBody = z
  .object({ released: z.number().int().nonnegative(), releaseFailed: z.number().int().nonnegative(), resolved: z.number().int().nonnegative(), remindersSent: z.number().int().nonnegative(), remindersDisplayOnly: z.number().int().nonnegative() })
  .strict();

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
    roomName: z.string().nullable(),
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
        rooms: z.number().int().min(1).max(6),
        priceCapMinor: z.number().int().positive().nullable(),
        mustHaves: z.array(z.string()),
        excludedCount: z.number().int().nonnegative(),
        nearLabel: z.string().min(1),
        nearIsNamed: z.boolean(),
        anchor: z.object({ latitude: z.number(), longitude: z.number(), label: z.string().min(1) }).strict().nullable(),
      })
      .strict()
      .nullable(),
    messages: z.array(message),
    shortlist: z.array(shortlistRow),
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

const bookingStatus = z.enum(['prebooked', 'payment_pending', 'paid', 'booking', 'confirmed', 'failed', 'cancelled']);
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
  })
  .strict();
export type BookingViewBody = z.infer<typeof bookingView>;

const holder = z.object({ firstName: z.string(), lastName: z.string() }).strict().nullable();
export const bookingPageBody = z
  .object({ booking: bookingView, me: z.object({ email: z.string().email() }).strict().nullable(), lastHolder: holder, payment: z.enum(['test', 'none']) })
  .strict();
export const bookingBody = z.object({ booking: bookingView }).strict();
export const bookingsBody = z
  .object({
    bookings: z.array(
      z.object({ id: uuid, status: z.enum(['confirmed', 'cancelled', 'booking']), hotelName: z.string().nullable(), checkIn: isoDate.nullable(), checkOut: isoDate.nullable() }).strict(),
    ),
  })
  .strict();
export const meBody = z.object({ user: z.object({ email: z.string().email() }).strict().nullable(), lastHolder: holder }).strict();
export const codeSentBody = z.object({ sent: z.literal(true), devCode: z.string().regex(/^\d{6}$/).optional() }).strict();
export const signedInBody = z.object({ signedIn: z.literal(true) }).strict();
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

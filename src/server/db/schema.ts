import { sql } from 'drizzle-orm';
import type { HotelCharge } from '@/lib/checkout';
import type { ScannedTrip } from '@/lib/scannedTrip';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The whole schema. Reasoning and traps: docs/schema.md.
 *
 * Every timestamp goes through `ts()` so it cannot be declared without a time
 * zone (schemaGuard.test.ts allows exactly one `timestamp(` call: this one).
 * Money is integer minor units plus a currency code, never a float.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ── Auth (Auth.js drizzle adapter shape) ────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: ts('email_verified'),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }),
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: ts('expires').notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: ts('expires').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

export const emailOtpCodes = pgTable(
  'email_otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({ byEmail: index('email_otp_codes_email_idx').on(t.email) }),
);

// ── Search state (the store) ────────────────────────────────────────────────

export const sessionStatus = pgEnum('session_status', ['onboarding', 'active', 'closed']);

/**
 * RETIRED single priority (architecture decision 8, superseded by multi-select
 * in docs/onboarding.md). Kept because migrations are additive: nothing
 * writes `priority` columns any more; `priorities` replaced them.
 */
export const LEGACY_PRIORITIES = ['cheapest', 'closest', 'nicest', 'basic'] as const;
export const priority = pgEnum('priority', LEGACY_PRIORITIES);

/** What "best" means to this user: a SET of these (docs/onboarding.md §3). */
export const PRIORITIES = ['cheapest', 'closest', 'nicest'] as const;
export const priorityKey = pgEnum('priority_key', PRIORITIES);

/** How the nationality used for rates was decided. `user` = picked by the user; the rest are inferred. */
export const NATIONALITY_SOURCES = ['user', 'saved', 'browser', 'ip', 'destination'] as const;
export const nationalitySource = pgEnum('nationality_source', NATIONALITY_SOURCES);

/** A destination that covers an area (a city, a neighbourhood) or is one point (an airport, a station, a venue). */
export const DESTINATION_KINDS = ['area', 'point'] as const;
export const destinationKind = pgEnum('destination_kind', DESTINATION_KINDS);

export const searchSessions = pgTable(
  'search_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null while anonymous; set when the session is adopted at sign-in. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The signed anonymous cookie id. Kept after adoption for the audit trail. */
    anonId: text('anon_id'),
    status: sessionStatus('status').notNull().default('onboarding'),
    /** Retired: see LEGACY_PRIORITIES. Never written. */
    priority: priority('priority'),
    /** null = not asked yet; [] = "no preference" (balanced). A set: order carries no meaning. */
    priorities: priorityKey('priorities').array(),
    currency: text('currency').notNull().default('EUR'),
    /** ISO 3166-1 alpha-2. The supplier refuses a rate search without it. Inferred, never asked; the user may change it. */
    guestNationality: text('guest_nationality'),
    nationalitySource: nationalitySource('nationality_source'),
    /** Onboarding answers given before there is enough to create a stay. */
    draft: jsonb('draft')
      .$type<{
        /** `point` is the supplier's place details for it; absent when the lookup failed. */
        destination?: { placeId: string; label: string; point?: { latitude: number; longitude: number; kind: 'area' | 'point'; country: string | null } };
        scanned?: ScannedTrip;
      }>()
      .notNull()
      .default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    byUser: index('search_sessions_user_idx').on(t.userId),
    byAnon: index('search_sessions_anon_idx').on(t.anonId),
    hasOwner: check('search_sessions_has_owner', sql`${t.userId} is not null or ${t.anonId} is not null`),
  }),
);

export const stays = pgTable(
  'stays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => searchSessions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    destinationText: text('destination_text').notNull(),
    /** Opaque, from the place resolver. Never authored by a model. */
    placeId: text('place_id'),
    /** The destination's own map point, from the supplier's place details. Never authored by a model. */
    destLatitude: doublePrecision('dest_latitude'),
    destLongitude: doublePrecision('dest_longitude'),
    destKind: destinationKind('dest_kind'),
    /** ISO 3166-1 alpha-2 of the destination, when the supplier gave one. */
    destCountry: text('dest_country'),
    /**
     * The place the user wants to be near, when they named one ("close to the
     * old town"). null = measure from the destination point. Point from the
     * supplier's place details only.
     */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    nearPlaceId: text('near_place_id'),
    nearLabel: text('near_label'),
    /** Machine dates, never free text. */
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkOut: date('check_out', { mode: 'string' }).notNull(),
    adults: integer('adults').notNull().default(2),
    /** One age per child: the supplier prices children by age. */
    childrenAges: jsonb('children_ages').$type<number[]>().notNull().default([]),
    /**
     * The number of rooms the user asked for. null = they did not say: the
     * finder prices the sensible splits of the party and shows each hotel's
     * cheapest (lib/finder/rooms.ts, docs/finder.md "Room splits").
     */
    rooms: integer('rooms'),
    /** Per night, in the session currency's minor units. */
    priceCapMinor: integer('price_cap_minor'),
    mustHaves: jsonb('must_haves').$type<string[]>().notNull().default([]),
    /** The filters (lib/filters.ts). null / [] = any. A listing silent on one misses it, and says so. */
    minStars: integer('min_stars'),
    minRating: doublePrecision('min_rating'),
    propertyTypes: jsonb('property_types').$type<string[]>().notNull().default([]),
    /** The supplier's chain names, exactly as listed. */
    chains: jsonb('chains').$type<string[]>().notNull().default([]),
    /** Hotels the user said no to for this stay. The finder never brings them back. */
    excludedPropertyIds: jsonb('excluded_property_ids').$type<string[]>().notNull().default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    onePerPosition: uniqueIndex('stays_session_position_idx').on(t.sessionId, t.position),
    datesOrdered: check('stays_dates_ordered', sql`${t.checkOut} > ${t.checkIn}`),
    someoneStays: check('stays_adults_positive', sql`${t.adults} >= 1 and ${t.rooms} >= 1`),
  }),
);

// ── Chat and turns ──────────────────────────────────────────────────────────

export const turnStatus = pgEnum('turn_status', ['queued', 'running', 'done', 'error']);

export const agentTurns = pgTable(
  'agent_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Arrival order. Timestamps tie; a sequence does not, and the queue is drained in this order. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    sessionId: uuid('session_id').notNull().references(() => searchSessions.id, { onDelete: 'cascade' }),
    /** Generated by the client per send; a retried send finds the same turn. Unique per search, not globally (below). */
    idempotencyKey: text('idempotency_key').notNull(),
    status: turnStatus('status').notNull().default('queued'),
    userMessage: text('user_message').notNull(),
    finalText: text('final_text'),
    errorCode: text('error_code'),
    /** Router decision, toolTrace, turnTrace, guard counts, staged action. */
    resultMeta: jsonb('result_meta').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => ({
    /** One running turn per session is a database fact, not a check-then-insert. */
    oneRunning: uniqueIndex('agent_turns_one_running_idx').on(t.sessionId).where(sql`status = 'running'`),
    bySession: index('agent_turns_session_idx').on(t.sessionId, t.seq),
    /**
     * A key is one search's own. Unique on the key alone, another visitor's search
     * sending the same key got the first search's turn back as a replay and its
     * message was dropped (e2e, 2026-11-13).
     */
    keyPerSession: uniqueIndex('agent_turns_session_key_idx').on(t.sessionId, t.idempotencyKey),
  }),
);

export const chatRole = pgEnum('chat_role', ['user', 'assistant']);

/**
 * `ai` and `user` are the only kinds the model ever sees. Form rows and the
 * payment row are rendered by the client and never enter model context.
 */
export const CHAT_KINDS = [
  'user',
  'ai',
  'line',
  'form_question',
  'form_answer',
  'otp_form',
  'guest_form',
  'payment_form',
  'receipt',
  'error',
] as const;
export const chatKind = pgEnum('chat_kind', CHAT_KINDS);

export const chatHistory = pgTable(
  'chat_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The order of the conversation. Two rows written in the same millisecond still have an order. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    sessionId: uuid('session_id').notNull().references(() => searchSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').references(() => agentTurns.id, { onDelete: 'set null' }),
    role: chatRole('role').notNull(),
    kind: chatKind('kind').notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({ bySession: index('chat_history_session_idx').on(t.sessionId, t.seq) }),
);

// ── Inventory ───────────────────────────────────────────────────────────────

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplier: text('supplier').notNull(),
    /** Opaque. Forwarded untouched. */
    supplierHotelId: text('supplier_hotel_id').notNull(),
    name: text('name').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    stars: doublePrecision('stars'),
    rating: doublePrecision('rating'),
    reviewCount: integer('review_count'),
    petsAllowed: boolean('pets_allowed'),
    parking: text('parking'),
    mainPhoto: text('main_photo'),
    address: text('address'),
    /** The rest of the supplier's static content, as received. */
    content: jsonb('content').$type<Record<string, unknown>>(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => ({ bySupplierId: uniqueIndex('properties_supplier_id_idx').on(t.supplier, t.supplierHotelId) }),
);

/**
 * Who an offer was quoted for. A `public` row holds the price a signed-out
 * visitor may see (lib/pricing.ts `publicQuote`); a `member` row the rate
 * itself, which never reaches an anonymous session.
 */
export const AUDIENCES = ['public', 'member'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const audience = pgEnum('audience', AUDIENCES);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => searchSessions.id, { onDelete: 'cascade' }),
    stayId: uuid('stay_id').notNull().references(() => stays.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    supplier: text('supplier').notNull(),
    /** Opaque. Forwarded untouched. */
    supplierOfferId: text('supplier_offer_id').notNull(),
    audience: audience('audience').notNull(),
    marginPct: numeric('margin_pct', { precision: 5, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    /** Whole stay, taxes and fees included. The primary number on a card. On a `public` row, never under the hotel's public price. */
    totalMinor: integer('total_minor').notNull(),
    /** `public` rows only: a signed-in member pays less for this room. The member rate itself is not kept here. */
    lowerForMembers: boolean('lower_for_members').notNull().default(false),
    /** The hotel's suggested public price, when the supplier sends one. */
    suggestedSellingMinor: integer('suggested_selling_minor'),
    /** Charges the supplier marks `included: false` (city tax at the desk). */
    payAtPropertyMinor: integer('pay_at_property_minor').notNull().default(0),
    taxesAndFees: jsonb('taxes_and_fees').$type<unknown[]>(),
    /** What the price is for, in words: one room's name, or every room's ("2 rooms: Double + Twin"). */
    roomName: text('room_name'),
    boardName: text('board_name'),
    /**
     * One entry per room, in occupancy order: the rooms the supplier priced
     * and who sleeps in each. Checkout books exactly these (re-checked first).
     * null on rows written before room splits.
     */
    rooms: jsonb('rooms').$type<Array<{ name: string; boardName: string | null; adults: number; childrenAges: number[] }>>(),
    refundableTag: text('refundable_tag'),
    cancellation: jsonb('cancellation').$type<Record<string, unknown>>(),
    fetchedAt: ts('fetched_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    /**
     * Fetched for one hotel's detail ("other rooms & rates"), not by a search.
     * Never ranked: opening a hotel must not change the shortlist.
     */
    detailOnly: boolean('detail_only').notNull().default(false),
  },
  (t) => ({
    byStay: index('offers_stay_idx').on(t.sessionId, t.stayId),
    nonNegative: check('offers_total_non_negative', sql`${t.totalMinor} >= 0 and ${t.payAtPropertyMinor} >= 0`),
    expiresAfterFetch: check('offers_expiry_after_fetch', sql`${t.expiresAt} > ${t.fetchedAt}`),
  }),
);

/** Declaration order is display order: Postgres sorts an enum by it, and listShortlist relies on that. */
export const SHORTLIST_SOURCES = ['finder', 'user_named'] as const;
export const shortlistSource = pgEnum('shortlist_source', SHORTLIST_SOURCES);

export const shortlistEntries = pgTable(
  'shortlist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => searchSessions.id, { onDelete: 'cascade' }),
    stayId: uuid('stay_id').notNull().references(() => stays.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    source: shortlistSource('source').notNull(),
    /** Machine-readable why-this-hotel, e.g. {kind:'cheapest_meeting_all_musts'}. */
    reason: jsonb('reason').$type<{ kind: string } & Record<string, unknown>>(),
    excluded: boolean('excluded').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byStay: index('shortlist_entries_stay_idx').on(t.sessionId, t.stayId, t.rank),
    /**
     * A finder row has a reason, and a priced offer unless it is a near-miss
     * whose only price is a member price an anonymous visitor may not see.
     */
    finderRowsAreSourced: check(
      'shortlist_finder_rows_sourced',
      sql`${t.source} = 'user_named' or (${t.reason} is not null and (${t.offerId} is not null or ${t.reason} @> '{"kind":"near_miss","misses":[{"kind":"member_price"}]}'::jsonb))`,
    ),
  }),
);

// ── Accounts ────────────────────────────────────────────────────────────────

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** Retired: see LEGACY_PRIORITIES. Never written. */
  priority: priority('priority'),
  priorities: priorityKey('priorities').array(),
  adults: integer('adults'),
  childrenAges: jsonb('children_ages').$type<number[]>(),
  mustHaves: jsonb('must_haves').$type<string[]>(),
  guestNationality: text('guest_nationality'),
  /** Only confirmed values are stored; this is when the user last said yes. */
  confirmedAt: ts('confirmed_at').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * `booking` is the claim taken BEFORE the supplier's book call. The supplier
 * answers a repeated book for one prebook with a second confirmed booking
 * (recorded: __fixtures__/book-same-prebook-again.json), so the call is made
 * only by whoever moved the row paid → booking, and never retried from there.
 *
 * Deal Freeze (docs/deal-freeze.md) books the free-cancellation rate before
 * anyone pays: `freezing` is its book claim, `frozen` the held booking,
 * `keeping` the claim before its payment, `releasing` the claim before its
 * cancel.
 */
export const BOOKING_STATUSES = [
  'prebooked',
  'payment_pending',
  'paid',
  'booking',
  'confirmed',
  'failed',
  'cancelled',
  'freezing',
  'frozen',
  'keeping',
  'releasing',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const bookingStatus = pgEnum('booking_status', BOOKING_STATUSES);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Set null on account deletion: the booking record outlives the account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => searchSessions.id, { onDelete: 'set null' }),
    offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    supplier: text('supplier').notNull(),
    /** The pair cannot be fetched again from the supplier: persist both before any payment form. */
    prebookId: text('prebook_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    supplierBookingId: text('supplier_booking_id'),
    hotelConfirmationCode: text('hotel_confirmation_code'),
    status: bookingStatus('status').notNull().default('prebooked'),
    currency: text('currency').notNull(),
    /** The price the supplier confirmed at prebook. */
    totalMinor: integer('total_minor').notNull(),
    /** The price on the offer the user picked. Differs when the rate changed. */
    quotedTotalMinor: integer('quoted_total_minor').notNull(),
    /**
     * What was booked, copied at the price check: the search it came from can
     * change afterwards (new dates, a new place), the booking does not.
     */
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    hotelName: text('hotel_name'),
    roomName: text('room_name'),
    boardName: text('board_name'),
    checkIn: date('check_in', { mode: 'string' }),
    checkOut: date('check_out', { mode: 'string' }),
    adults: integer('adults'),
    childrenAges: jsonb('children_ages').$type<number[]>(),
    rooms: integer('rooms'),
    payAtPropertyMinor: integer('pay_at_property_minor'),
    /**
     * The charges the offer marks not included, each in its own currency, as
     * the supplier names them: what the guest pays at the hotel. Null on rows
     * written before it was kept.
     */
    payAtPropertyFees: jsonb('pay_at_property_fees').$type<HotelCharge[]>(),
    /**
     * The guest's special request, as typed at checkout (cleaned, at most 500
     * characters). Sent to the supplier with book as each room's `remarks`; the
     * hotel may not honour it. Data, never instructions.
     */
    specialRequest: text('special_request'),
    /** The cancellation terms the supplier confirmed at prebook (normalized CancellationPolicy). */
    cancellation: jsonb('cancellation').$type<Record<string, unknown>>(),
    /** Who the room is booked for, as typed at checkout. */
    holderFirstName: text('holder_first_name'),
    holderLastName: text('holder_last_name'),
    holderEmail: text('holder_email'),
    /** The wallet the guest paid with. `test` payments move no money (sandbox only). */
    paidWith: text('paid_with'),
    testPayment: boolean('test_payment').notNull().default(false),
    /** Why a booking ended in `failed`: an ErrorCode, never supplier text. */
    failureCode: text('failure_code'),
    refundMinor: integer('refund_minor'),
    cancelFeeMinor: integer('cancel_fee_minor'),
    /** Deal Freeze: the hold is released at this instant unless kept; before the free-cancellation deadline. */
    frozenUntil: ts('frozen_until'),
    /** Deal Freeze: when the reminder is due, and when an email for it actually went out (null: never sent). */
    freezeReminderDueAt: ts('freeze_reminder_due_at'),
    freezeReminderSentAt: ts('freeze_reminder_sent_at'),
    /** Deal Freeze: who released the hold, `guest` or `expiry`. Null when not released. */
    releasedBy: text('released_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    onePerPrebook: uniqueIndex('bookings_supplier_prebook_idx').on(t.supplier, t.prebookId),
    byUser: index('bookings_user_idx').on(t.userId),
    /** The freeze sweep: frozen rows whose hold has ended. */
    byFreeze: index('bookings_freeze_idx').on(t.status, t.frozenUntil),
  }),
);

// ── Ledger and switches ─────────────────────────────────────────────────────

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Set null on account deletion: spend history survives anonymously. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => searchSessions.id, { onDelete: 'set null' }),
    /**
     * The anonymous cookie, for calls made before a search exists (the trip
     * box's place lookups). Lets the admin view charge them to the search that
     * visitor started next (docs/usage.md).
     */
    anonId: text('anon_id'),
    /** 'anthropic', 'jev', 'liteapi:search', 'liteapi:prebook', 'google:places', … */
    provider: text('provider').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    /** 1 cent = 1,000,000 microcents. bigint: $25 already overflows int4. */
    costMicrocents: bigint('cost_microcents', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms'),
    success: boolean('success').notNull(),
    errorMessage: text('error_message'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byUser: index('usage_events_user_idx').on(t.userId, t.createdAt),
    bySession: index('usage_events_session_idx').on(t.sessionId, t.createdAt),
    byAnon: index('usage_events_anon_idx').on(t.anonId, t.createdAt),
    byProvider: index('usage_events_provider_idx').on(t.provider, t.createdAt),
  }),
);

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const ipRequestCounters = pgTable(
  'ip_request_counters',
  {
    ip: text('ip').notNull(),
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.ip, t.windowStart] }) }),
);

export const ideas = pgTable('ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => searchSessions.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * Hotels a visitor saved (the heart). Owned like a search: by the account, or
 * before sign-in by the signed anonymous cookie, and handed to the account at
 * sign-in. No price is stored here: the last price found is read from the
 * visitor's own offer rows, with the date it was fetched (docs/saved.md).
 */
export const savedHotels = pgTable(
  'saved_hotels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null while anonymous; set when the visitor signs in. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The signed anonymous cookie id it was saved under. Kept after sign-in, like a search's. */
    anonId: text('anon_id'),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    /** The search it was saved from, to open again. */
    sessionId: uuid('session_id').references(() => searchSessions.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({
    oncePerAccount: uniqueIndex('saved_hotels_user_property_idx').on(t.userId, t.propertyId).where(sql`${t.userId} is not null`),
    oncePerVisitor: uniqueIndex('saved_hotels_anon_property_idx').on(t.anonId, t.propertyId).where(sql`${t.userId} is null`),
    hasOwner: check('saved_hotels_has_owner', sql`${t.userId} is not null or ${t.anonId} is not null`),
  }),
);

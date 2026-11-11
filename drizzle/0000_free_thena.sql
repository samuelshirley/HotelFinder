CREATE TYPE "public"."audience" AS ENUM('public', 'member');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('prebooked', 'payment_pending', 'paid', 'booking', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."chat_kind" AS ENUM('user', 'ai', 'line', 'form_question', 'form_answer', 'otp_form', 'guest_form', 'payment_form', 'receipt', 'error');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('cheapest', 'closest', 'nicest', 'basic');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('onboarding', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."shortlist_source" AS ENUM('finder', 'user_named');--> statement-breakpoint
CREATE TYPE "public"."turn_status" AS ENUM('queued', 'running', 'done', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"session_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "turn_status" DEFAULT 'queued' NOT NULL,
	"user_message" text NOT NULL,
	"final_text" text,
	"error_code" text,
	"result_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_turns_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"offer_id" uuid,
	"supplier" text NOT NULL,
	"prebook_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"supplier_booking_id" text,
	"hotel_confirmation_code" text,
	"status" "booking_status" DEFAULT 'prebooked' NOT NULL,
	"currency" text NOT NULL,
	"total_minor" integer NOT NULL,
	"quoted_total_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid,
	"role" "chat_role" NOT NULL,
	"kind" "chat_kind" NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ip_request_counters" (
	"ip" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ip_request_counters_ip_window_start_pk" PRIMARY KEY("ip","window_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"supplier_offer_id" text NOT NULL,
	"audience" "audience" NOT NULL,
	"margin_pct" numeric(5, 2) NOT NULL,
	"currency" text NOT NULL,
	"total_minor" integer NOT NULL,
	"suggested_selling_minor" integer,
	"pay_at_property_minor" integer DEFAULT 0 NOT NULL,
	"taxes_and_fees" jsonb,
	"room_name" text,
	"board_name" text,
	"refundable_tag" text,
	"cancellation" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_total_non_negative" CHECK ("offers"."total_minor" >= 0 and "offers"."pay_at_property_minor" >= 0),
	CONSTRAINT "offers_expiry_after_fetch" CHECK ("offers"."expires_at" > "offers"."fetched_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" text NOT NULL,
	"supplier_hotel_id" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"stars" double precision,
	"rating" double precision,
	"review_count" integer,
	"pets_allowed" boolean,
	"parking" text,
	"main_photo" text,
	"address" text,
	"content" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_id" text,
	"status" "session_status" DEFAULT 'onboarding' NOT NULL,
	"priority" "priority",
	"currency" text DEFAULT 'EUR' NOT NULL,
	"guest_nationality" text,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_sessions_has_owner" CHECK ("search_sessions"."user_id" is not null or "search_sessions"."anon_id" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shortlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"offer_id" uuid,
	"rank" integer NOT NULL,
	"source" "shortlist_source" NOT NULL,
	"reason" jsonb,
	"excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortlist_finder_rows_sourced" CHECK ("shortlist_entries"."source" = 'user_named' or ("shortlist_entries"."offer_id" is not null and "shortlist_entries"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"destination_text" text NOT NULL,
	"place_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer DEFAULT 2 NOT NULL,
	"children_ages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rooms" integer DEFAULT 1 NOT NULL,
	"price_cap_minor" integer,
	"must_haves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stays_dates_ordered" CHECK ("stays"."check_out" > "stays"."check_in"),
	CONSTRAINT "stays_adults_positive" CHECK ("stays"."adults" >= 1 and "stays"."rooms" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_microcents" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"success" boolean NOT NULL,
	"error_message" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"priority" "priority",
	"adults" integer,
	"children_ages" jsonb,
	"must_haves" jsonb,
	"guest_nationality" text,
	"confirmed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ideas" ADD CONSTRAINT "ideas_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_sessions" ADD CONSTRAINT "search_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stays" ADD CONSTRAINT "stays_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_turns_one_running_idx" ON "agent_turns" USING btree ("session_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turns_session_idx" ON "agent_turns" USING btree ("session_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_supplier_prebook_idx" ON "bookings" USING btree ("supplier","prebook_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_user_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_history_session_idx" ON "chat_history" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_otp_codes_email_idx" ON "email_otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_stay_idx" ON "offers" USING btree ("session_id","stay_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "properties_supplier_id_idx" ON "properties" USING btree ("supplier","supplier_hotel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_sessions_user_idx" ON "search_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_sessions_anon_idx" ON "search_sessions" USING btree ("anon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shortlist_entries_stay_idx" ON "shortlist_entries" USING btree ("session_id","stay_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stays_session_position_idx" ON "stays" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_session_idx" ON "usage_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_provider_idx" ON "usage_events" USING btree ("provider","created_at");
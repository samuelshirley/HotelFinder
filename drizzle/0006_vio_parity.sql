ALTER TYPE "public"."booking_status" ADD VALUE 'freezing';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'frozen';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'keeping';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'releasing';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_id" text,
	"property_id" uuid NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_hotels_has_owner" CHECK ("saved_hotels"."user_id" is not null or "saved_hotels"."anon_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "stays" ALTER COLUMN "rooms" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stays" ALTER COLUMN "rooms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pay_at_property_fees" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "special_request" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "frozen_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "released_by" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "rooms" jsonb;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_stars" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_rating" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "property_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "chains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_hotels" ADD CONSTRAINT "saved_hotels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_hotels" ADD CONSTRAINT "saved_hotels_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_hotels" ADD CONSTRAINT "saved_hotels_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_hotels_user_property_idx" ON "saved_hotels" USING btree ("user_id","property_id") WHERE "saved_hotels"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_hotels_anon_property_idx" ON "saved_hotels" USING btree ("anon_id","property_id") WHERE "saved_hotels"."user_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_freeze_idx" ON "bookings" USING btree ("status","frozen_until");
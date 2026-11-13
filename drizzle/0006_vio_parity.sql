ALTER TYPE "public"."booking_status" ADD VALUE 'freezing';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'frozen';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'keeping';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'releasing';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pay_at_property_fees" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "special_request" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "frozen_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "released_by" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_stars" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_rating" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "property_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "chains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_freeze_idx" ON "bookings" USING btree ("status","frozen_until");
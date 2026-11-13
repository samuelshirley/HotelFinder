ALTER TYPE "public"."booking_status" ADD VALUE 'freezing';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'frozen';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'keeping';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'releasing';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "frozen_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "freeze_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "released_by" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_freeze_idx" ON "bookings" USING btree ("status","frozen_until");
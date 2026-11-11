ALTER TABLE "bookings" ADD COLUMN "property_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "hotel_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "room_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "board_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "check_in" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "check_out" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "adults" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "children_ages" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rooms" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pay_at_property_minor" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "holder_first_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "holder_last_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "holder_email" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paid_with" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "test_payment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "refund_minor" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_fee_minor" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

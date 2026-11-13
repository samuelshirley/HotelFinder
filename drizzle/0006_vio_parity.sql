ALTER TABLE "bookings" ADD COLUMN "pay_at_property_fees" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "special_request" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_stars" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_rating" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "property_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "chains" jsonb DEFAULT '[]'::jsonb NOT NULL;
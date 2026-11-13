ALTER TABLE "stays" ADD COLUMN "min_stars" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "min_rating" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "property_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "chains" jsonb DEFAULT '[]'::jsonb NOT NULL;
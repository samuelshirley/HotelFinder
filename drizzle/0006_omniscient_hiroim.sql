ALTER TABLE "stays" ALTER COLUMN "rooms" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stays" ALTER COLUMN "rooms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "rooms" jsonb;
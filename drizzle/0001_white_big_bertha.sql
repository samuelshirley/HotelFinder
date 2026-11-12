CREATE TYPE "public"."destination_kind" AS ENUM('area', 'point');--> statement-breakpoint
CREATE TYPE "public"."nationality_source" AS ENUM('user', 'saved', 'browser', 'ip', 'destination');--> statement-breakpoint
CREATE TYPE "public"."priority_key" AS ENUM('cheapest', 'closest', 'nicest');--> statement-breakpoint
ALTER TABLE "search_sessions" ADD COLUMN "priorities" "priority_key"[];--> statement-breakpoint
ALTER TABLE "search_sessions" ADD COLUMN "nationality_source" "nationality_source";--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "dest_latitude" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "dest_longitude" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "dest_kind" "destination_kind";--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "dest_country" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "near_place_id" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "near_label" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "priorities" "priority_key"[];--> statement-breakpoint
-- Carry the retired single priority into the set. "basic" (a decent bed, cheap) becomes low price + great reviews.
UPDATE "search_sessions" SET "priorities" = CASE "priority" WHEN 'basic' THEN ARRAY['cheapest','nicest']::"priority_key"[] ELSE ARRAY["priority"::text]::"priority_key"[] END WHERE "priority" IS NOT NULL;--> statement-breakpoint
UPDATE "user_preferences" SET "priorities" = CASE "priority" WHEN 'basic' THEN ARRAY['cheapest','nicest']::"priority_key"[] ELSE ARRAY["priority"::text]::"priority_key"[] END WHERE "priority" IS NOT NULL;

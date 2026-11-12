ALTER TABLE "usage_events" ADD COLUMN "anon_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_anon_idx" ON "usage_events" USING btree ("anon_id","created_at");
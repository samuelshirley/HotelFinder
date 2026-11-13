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
CREATE UNIQUE INDEX IF NOT EXISTS "saved_hotels_anon_property_idx" ON "saved_hotels" USING btree ("anon_id","property_id") WHERE "saved_hotels"."user_id" is null;
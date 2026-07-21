CREATE SCHEMA "platform";
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE "app_rw";
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenants_self_isolation" ON "platform"."tenants" AS PERMISSIVE FOR ALL TO public USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
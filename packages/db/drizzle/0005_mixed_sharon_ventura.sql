CREATE TABLE "platform"."event_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" uuid,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."event_archive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" uuid,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relayed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "outbox_unrelayed_idx" ON "platform"."outbox" USING btree ("created_at") WHERE relayed_at IS NULL;--> statement-breakpoint
CREATE POLICY "event_archive_tenant_isolation" ON "platform"."event_archive" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "platform"."outbox" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
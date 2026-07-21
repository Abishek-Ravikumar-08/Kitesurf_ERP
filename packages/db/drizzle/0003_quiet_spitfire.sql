CREATE TABLE "platform"."audit_head" (
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"last_seq" integer NOT NULL,
	"last_hash" text NOT NULL,
	CONSTRAINT "audit_head_tenant_id_aggregate_type_aggregate_id_pk" PRIMARY KEY("tenant_id","aggregate_type","aggregate_id")
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_head" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"seq" integer NOT NULL,
	"action" text NOT NULL,
	"actor" uuid,
	"correlation_id" text,
	"payload_hash" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_chain_uq" ON "platform"."audit_log" USING btree ("tenant_id","aggregate_type","aggregate_id","seq");--> statement-breakpoint
CREATE POLICY "audit_head_tenant_isolation" ON "platform"."audit_head" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "platform"."audit_log" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
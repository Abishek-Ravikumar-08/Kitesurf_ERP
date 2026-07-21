CREATE TABLE "md"."number_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"range_key" text NOT NULL,
	"period" text NOT NULL,
	"value" bigint NOT NULL,
	"doc_ref" text,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "md"."number_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "md"."number_ranges" (
	"tenant_id" uuid NOT NULL,
	"range_key" text NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"pad_to" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_ranges_tenant_id_range_key_period_pk" PRIMARY KEY("tenant_id","range_key","period")
);
--> statement-breakpoint
ALTER TABLE "md"."number_ranges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "number_alloc_uq" ON "md"."number_allocations" USING btree ("tenant_id","range_key","period","value");--> statement-breakpoint
CREATE POLICY "number_allocations_tenant_isolation" ON "md"."number_allocations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "number_ranges_tenant_isolation" ON "md"."number_ranges" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
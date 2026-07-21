CREATE SCHEMA "fin";
--> statement-breakpoint
CREATE TABLE "fin"."fiscal_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"period" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "fiscal_period_range" CHECK (period BETWEEN 1 AND 12),
	CONSTRAINT "fiscal_period_dates" CHECK (starts_on <= ends_on),
	CONSTRAINT "fiscal_period_status" CHECK (status IN ('open','closed'))
);
--> statement-breakpoint
ALTER TABLE "fin"."fiscal_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_period_uq" ON "fin"."fiscal_periods" USING btree ("tenant_id","year","period");--> statement-breakpoint
CREATE POLICY "fiscal_periods_tenant_isolation" ON "fin"."fiscal_periods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
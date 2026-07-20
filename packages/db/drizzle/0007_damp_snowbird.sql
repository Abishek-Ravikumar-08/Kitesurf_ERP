CREATE SCHEMA "md";
--> statement-breakpoint
CREATE SCHEMA "wh";
--> statement-breakpoint
CREATE TABLE "md"."materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"base_uom" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "md"."materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wh"."stock_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"on_hand" numeric(18, 6) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 6) DEFAULT '0' NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reserved_nonneg" CHECK (reserved >= 0),
	CONSTRAINT "stock_no_oversell" CHECK (allow_negative OR reserved <= on_hand)
);
--> statement-breakpoint
ALTER TABLE "wh"."stock_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wh"."stock_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "reservation_qty_positive" CHECK (qty > 0),
	CONSTRAINT "reservation_kind" CHECK (kind IN ('soft','hard')),
	CONSTRAINT "reservation_status" CHECK (status IN ('active','released','consumed'))
);
--> statement-breakpoint
ALTER TABLE "wh"."stock_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "materials_tenant_sku_uq" ON "md"."materials" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_tenant_material_uq" ON "wh"."stock_items" USING btree ("tenant_id","material_id");--> statement-breakpoint
CREATE POLICY "materials_tenant_isolation" ON "md"."materials" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "stock_items_tenant_isolation" ON "wh"."stock_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "stock_reservations_tenant_isolation" ON "wh"."stock_reservations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
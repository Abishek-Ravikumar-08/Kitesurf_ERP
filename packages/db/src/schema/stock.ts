import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Inlined copies of tenantCtx/tenantIsolation from ./rls.js — drizzle-kit's
// esbuild/CJS loader cannot resolve relative ".js" imports between schema files (D-017),
// so schema files stay import-free of each other. Keep in sync with rls.ts (same SQL,
// fail-closed). drizzle-kit merges pgSchema declarations by name — no duplicate
// CREATE SCHEMA is generated.
const tenantCtx = sql`NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const tenantIsolation = (policyName: string) =>
  pgPolicy(policyName, {
    as: "permissive",
    for: "all",
    using: sql`tenant_id = ${tenantCtx}`,
    withCheck: sql`tenant_id = ${tenantCtx}`,
  });

export const whSchema = pgSchema("wh");

/**
 * One row per (tenant, material): the ATP counters. `reserved` is the sum of active
 * reservations; available = on_hand - reserved. The atomic guarded UPDATE in
 * @erp/platform/stock is the primary oversell invariant; the CHECKs are belt-and-braces.
 */
export const stockItems = whSchema.table(
  "stock_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    // FK to "md"."materials"(id) added in the custom migration — drizzle-kit's loader
    // cannot resolve cross-file table imports (see D-017), so no .references() here.
    materialId: uuid("material_id").notNull(),
    onHand: numeric("on_hand", { precision: 18, scale: 6 }).notNull().default("0"),
    reserved: numeric("reserved", { precision: 18, scale: 6 }).notNull().default("0"),
    allowNegative: boolean("allow_negative").notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_items_tenant_material_uq").on(t.tenantId, t.materialId),
    check("stock_reserved_nonneg", sql`reserved >= 0`),
    check("stock_no_oversell", sql`allow_negative OR reserved <= on_hand`),
    tenantIsolation("stock_items_tenant_isolation"),
  ],
);

/** Reservation ledger: every active row is counted in stock_items.reserved. */
export const stockReservations = whSchema.table(
  "stock_reservations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    // FK to "wh"."stock_items"(id) added in the custom migration (same D-017 note; kept
    // as raw SQL so both FK constraints live in one reviewed place).
    stockItemId: uuid("stock_item_id").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    kind: text("kind").notNull(), // 'soft' | 'hard'
    status: text("status").notNull().default("active"), // 'active' | 'released' | 'consumed'
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  () => [
    check("reservation_qty_positive", sql`qty > 0`),
    check("reservation_kind", sql`kind IN ('soft','hard')`),
    check("reservation_status", sql`status IN ('active','released','consumed')`),
    tenantIsolation("stock_reservations_tenant_isolation"),
  ],
);

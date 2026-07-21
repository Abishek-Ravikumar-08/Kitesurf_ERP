import { sql } from "drizzle-orm";
import { pgPolicy, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const mdSchema = pgSchema("md");

/** Minimal stub so stock gets a real FK from birth; Phase-3 MDM expands it (expand/contract). */
export const materials = mdSchema.table(
  "materials",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    baseUom: text("base_uom").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("materials_tenant_sku_uq").on(t.tenantId, t.sku),
    tenantIsolation("materials_tenant_isolation"),
  ],
);

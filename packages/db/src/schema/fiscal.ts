import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
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

export const finSchema = pgSchema("fin");

/** Periods gate postings by POSTING date (document date is carried by documents, not here).
 * Dates are calendar dates (no timezone) — UTC storage/display conversion is a UI concern.
 * The no-overlap-per-tenant EXCLUDE constraint (btree_gist) lives in the custom migration
 * (drizzle-kit cannot express exclusion constraints). */
export const fiscalPeriods = finSchema.table(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    year: integer("year").notNull(),
    period: integer("period").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"), // 'open' | 'closed'
    version: integer("version").notNull().default(1),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
  },
  (t) => [
    uniqueIndex("fiscal_period_uq").on(t.tenantId, t.year, t.period),
    check("fiscal_period_range", sql`period BETWEEN 1 AND 12`),
    check("fiscal_period_dates", sql`starts_on <= ends_on`),
    check("fiscal_period_status", sql`status IN ('open','closed')`),
    tenantIsolation("fiscal_periods_tenant_isolation"),
  ],
);

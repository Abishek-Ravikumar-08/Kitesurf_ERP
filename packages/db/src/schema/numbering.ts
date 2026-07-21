import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  pgPolicy,
  pgSchema,
  primaryKey,
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

// Local (non-exported) handle — masterdata.ts exports the canonical mdSchema; drizzle-kit
// merges pgSchema declarations by name, so this generates no duplicate CREATE SCHEMA.
const mdSchema = pgSchema("md");

/** Counter row per (tenant, range, period) — the short row lock on UPDATE serializes
 * allocation across ALL processes (also old+new binaries during a rollout: same row,
 * same lock — no gaps, no double allocations). Unpartitioned by design (spec §9.1). */
export const numberRanges = mdSchema.table(
  "number_ranges",
  {
    tenantId: uuid("tenant_id").notNull(),
    rangeKey: text("range_key").notNull(),
    period: text("period").notNull().default(""),
    currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
    prefix: text("prefix").notNull().default(""),
    padTo: integer("pad_to").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.rangeKey, t.period] }),
    tenantIsolation("number_ranges_tenant_isolation"),
  ],
);

/** In-tx allocation journal: the uniqueness constraint is the DB-level double-allocation
 * tripwire; detectGaps scans it for holes (gaps are DETECTED and explainable, not
 * prevented — a crash after allocate rolls the journal row back too). */
export const numberAllocations = mdSchema.table(
  "number_allocations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    rangeKey: text("range_key").notNull(),
    period: text("period").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    docRef: text("doc_ref"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("number_alloc_uq").on(t.tenantId, t.rangeKey, t.period, t.value),
    tenantIsolation("number_allocations_tenant_isolation"),
  ],
);

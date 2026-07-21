import { sql } from "drizzle-orm";
import {
  integer,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Inlined copies of platformSchema/tenantCtx/tenantIsolation from ./rls.js — drizzle-kit's
// esbuild/CJS loader cannot resolve relative ".js" imports between schema files (D-017),
// so schema files stay import-free of each other. Keep in sync with rls.ts (same SQL,
// fail-closed). drizzle-kit merges pgSchema declarations by name — no duplicate
// CREATE SCHEMA is generated.
const tenantCtx = sql`NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const platformSchema = pgSchema("platform");
const tenantIsolation = (policyName: string) =>
  pgPolicy(policyName, {
    as: "permissive",
    for: "all",
    using: sql`tenant_id = ${tenantCtx}`,
    withCheck: sql`tenant_id = ${tenantCtx}`,
  });

/**
 * Chain head per aggregate — row-locked on every append to serialize the chain.
 * Mutable by design (the log is the immutable record; verify cross-checks head against log).
 */
export const auditHead = platformSchema.table(
  "audit_head",
  {
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    lastSeq: integer("last_seq").notNull(),
    lastHash: text("last_hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.aggregateType, t.aggregateId] }),
    tenantIsolation("audit_head_tenant_isolation"),
  ],
);

/** Append-only, hash-chained, PII-free (payload HASH only, never the payload). */
export const auditLog = platformSchema.table(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    seq: integer("seq").notNull(),
    action: text("action").notNull(),
    actor: uuid("actor"),
    correlationId: text("correlation_id"),
    payloadHash: text("payload_hash").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_log_chain_uq").on(t.tenantId, t.aggregateType, t.aggregateId, t.seq),
    tenantIsolation("audit_log_tenant_isolation"),
  ],
);

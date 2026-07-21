import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
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

/** The canonical §8 DomainEvent envelope, persisted column-per-field. */
const envelopeColumns = {
  id: uuid("id").primaryKey(), // = eventId
  tenantId: uuid("tenant_id").notNull(),
  type: text("type").notNull(),
  eventVersion: integer("event_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  actor: uuid("actor"),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  payload: jsonb("payload").notNull(),
};

/**
 * Transactional outbox: domain events are INSERTed in the same tx as the business write +
 * audit row; the worker's relay claims unrelayed rows and fans them out to pg-boss queues.
 */
export const outbox = platformSchema.table(
  "outbox",
  {
    ...envelopeColumns,
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    relayedAt: timestamp("relayed_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_unrelayed_idx").on(t.createdAt).where(sql`relayed_at IS NULL`),
    tenantIsolation("outbox_tenant_isolation"),
  ],
);

/** Durable, never-pruned replay/audit log of every relayed event (spec §9.2). */
export const eventArchive = platformSchema.table(
  "event_archive",
  {
    ...envelopeColumns,
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolation("event_archive_tenant_isolation")],
);

import type { Db } from "@erp/db";
import { sql } from "drizzle-orm";

/** Structural slice of pg-boss the relay needs (tests may pass the real PgBoss instance). */
export interface PgBossLike {
  send(name: string, data: object, options?: { singletonKey?: string }): Promise<string | null>;
}

/** Maps event types to the pg-boss queues that consume them. Phase 2 prod registry is empty. */
export class ConsumerRegistry {
  constructor(private readonly map: Record<string, string[]> = {}) {}
  queuesFor(eventType: string): string[] {
    return this.map[eventType] ?? [];
  }
  allQueues(): string[] {
    return [...new Set(Object.values(this.map).flat())];
  }
}

/**
 * Drain one batch: claim unrelayed rows (SKIP LOCKED — safe with concurrent relays),
 * archive each (idempotent), fan out one job per consumer queue (singletonKey = eventId
 * gives best-effort dedupe while queued; consumers MUST be idempotent — delivery is
 * at-least-once by design), then mark relayed. Runs on the worker's owner connection:
 * cross-tenant infrastructure that never mutates domain tables.
 */
export async function relayOutboxBatch(
  db: Db,
  boss: PgBossLike,
  registry: ConsumerRegistry,
  opts: { batchSize?: number } = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? 50;
  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      SELECT id, tenant_id, type, event_version, occurred_at, actor, correlation_id, causation_id, payload
      FROM platform.outbox WHERE relayed_at IS NULL
      ORDER BY created_at LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);
    for (const r of claimed.rows as Array<Record<string, unknown>>) {
      await tx.execute(sql`
        INSERT INTO platform.event_archive (id, tenant_id, type, event_version, occurred_at, actor, correlation_id, causation_id, payload)
        VALUES (${r.id}, ${r.tenant_id}, ${r.type}, ${r.event_version}, ${r.occurred_at}, ${r.actor}, ${r.correlation_id}, ${r.causation_id}, ${JSON.stringify(r.payload)}::jsonb)
        ON CONFLICT (id) DO NOTHING
      `);
      // Jobs carry the CANONICAL §8 DomainEvent envelope (camelCase), not the raw SQL row —
      // this is the wire contract Phase-3 consumers build against.
      // drizzle's raw execute() bypasses pg's Date parser: timestamptz comes back as a
      // string ("2026-07-20 10:00:00+00") — normalize to the envelope's ISO-8601 form.
      const occurredAtRaw = r.occurred_at as string | Date;
      const envelope = {
        eventId: r.id as string,
        type: r.type as string,
        eventVersion: r.event_version as number,
        occurredAt: (occurredAtRaw instanceof Date
          ? occurredAtRaw
          : new Date(occurredAtRaw)
        ).toISOString(),
        tenantId: r.tenant_id as string,
        actor: (r.actor as string | null) ?? null,
        correlationId: r.correlation_id as string,
        ...(r.causation_id ? { causationId: r.causation_id as string } : {}),
        payload: r.payload,
      };
      for (const queue of registry.queuesFor(envelope.type)) {
        await boss.send(queue, envelope, { singletonKey: envelope.eventId });
      }
    }
    if (claimed.rows.length > 0) {
      // drizzle's raw sql serializes a JS array param as JSON ('[...]'), which Postgres
      // rejects for uuid[] — join individual params into a typed ARRAY[...] instead.
      const ids = (claimed.rows as Array<{ id: string }>).map((r) => r.id);
      const idList = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(
        sql`UPDATE platform.outbox SET relayed_at = now() WHERE id = ANY(ARRAY[${idList}]::uuid[])`,
      );
    }
    return claimed.rows.length;
  });
}

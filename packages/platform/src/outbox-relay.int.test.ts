import { randomUUID } from "node:crypto";
import { schema, withTenantTx } from "@erp/db";
import { asTenantId, createEvent } from "@erp/kernel";
import { eq, sql } from "drizzle-orm";
// pg-boss 12 is pure ESM with a NAMED export — there is no default export.
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit } from "./audit.js";
import { ConsumerRegistry, relayOutboxBatch } from "./outbox-relay.js";
import { appendOutbox } from "./outbox.js";
import { type TestDb, expectPgError, startTestDb } from "./testkit.js";

describe("transactional outbox + relay", () => {
  let t: TestDb;
  let boss: PgBoss;
  const registry = new ConsumerRegistry({ TestThingHappened: ["test-queue"] });
  // Shared across the ordered tests below (they tell one story: relay → idempotent
  // re-run → crash-recovery duplicate).
  let eventId: string;

  beforeAll(async () => {
    t = await startTestDb();
    boss = new PgBoss(t.container.getConnectionUri());
    boss.on("error", () => {}); // don't crash the suite on background pg-boss errors
    await boss.start();
    await boss.createQueue("test-queue");
  });
  afterAll(async () => {
    try {
      await boss?.stop();
    } finally {
      await t.stop();
    }
  });

  async function countJobs(): Promise<number> {
    const res = await t.handle.db.execute(
      sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'test-queue'`,
    );
    return (res.rows[0] as { n: number }).n;
  }

  it("same-tx write + relay round trip delivers the camelCase envelope", async () => {
    const event = createEvent({
      type: "TestThingHappened",
      eventVersion: 1,
      tenantId: asTenantId(t.tenantId),
      actor: null,
      payload: { thing: "kite", qty: 3 },
      occurredAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    eventId = event.eventId;

    // Business write + audit + outbox commit ATOMICALLY in one tenant tx.
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, async (tx) => {
      await appendAudit(tx, {
        tenantId: t.tenantId,
        aggregateType: "TestThing",
        aggregateId: "tt-1",
        action: "happened",
        payload: event.payload,
      });
      await appendOutbox(tx, event);
    });

    const relayed = await relayOutboxBatch(t.handle.db, boss, registry);
    expect(relayed).toBe(1);

    const archived = await t.handle.db
      .select()
      .from(schema.eventArchive)
      .where(eq(schema.eventArchive.id, eventId));
    expect(archived).toHaveLength(1);
    expect(archived[0]?.type).toBe("TestThingHappened");

    const [outboxRow] = await t.handle.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, eventId));
    expect(outboxRow?.relayedAt).toBeInstanceOf(Date);

    const jobs = await boss.fetch("test-queue");
    expect(jobs).toHaveLength(1);
    // The wire contract is the CANONICAL §8 DomainEvent envelope — camelCase, not sql rows.
    const data = jobs[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({
      eventId,
      type: "TestThingHappened",
      eventVersion: 1,
      occurredAt: "2026-07-20T10:00:00.000Z",
      tenantId: t.tenantId,
      actor: null,
      correlationId: event.correlationId,
      payload: { thing: "kite", qty: 3 },
    });
    expect(data).not.toHaveProperty("event_id");
    expect(data).not.toHaveProperty("tenant_id");
    expect(data).not.toHaveProperty("event_version");
    expect(data).not.toHaveProperty("occurred_at");
    expect(data).not.toHaveProperty("correlation_id");
  });

  it("re-running the relay is a no-op (idempotent)", async () => {
    const relayed = await relayOutboxBatch(t.handle.db, boss, registry);
    expect(relayed).toBe(0);

    const archived = await t.handle.db
      .select()
      .from(schema.eventArchive)
      .where(eq(schema.eventArchive.id, eventId));
    expect(archived).toHaveLength(1);
    expect(await countJobs()).toBe(1);
  });

  it("tolerates a crash-recovery duplicate: archive unchanged, at-least-once delivery", async () => {
    // Simulate the relay crashing AFTER archiving/sending but BEFORE marking relayed:
    // superuser resets the marker and the relay runs again.
    await t.handle.db.execute(
      sql`UPDATE platform.outbox SET relayed_at = NULL WHERE id = ${eventId}`,
    );
    const relayed = await relayOutboxBatch(t.handle.db, boss, registry);
    expect(relayed).toBe(1);

    // ON CONFLICT (id) DO NOTHING: the durable archive never duplicates.
    const archived = await t.handle.db
      .select()
      .from(schema.eventArchive)
      .where(eq(schema.eventArchive.id, eventId));
    expect(archived).toHaveLength(1);

    // Delivery is AT-LEAST-ONCE by design: the duplicate send may or may not be
    // suppressed (singletonKey only dedupes while a matching job is queued).
    // Consumers MUST be idempotent and dedupe by eventId.
    expect(await countJobs()).toBeLessThanOrEqual(2);
  });

  it("a rolled-back transaction writes NOTHING to the outbox", async () => {
    const event = createEvent({
      type: "TestThingHappened",
      eventVersion: 1,
      tenantId: asTenantId(t.tenantId),
      actor: null,
      payload: { doomed: true },
      occurredAt: new Date(),
    });
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, async (tx) => {
        await appendOutbox(tx, event);
        throw new Error("boom — roll it all back");
      }),
    ).rejects.toThrow(/boom/);

    const rows = await t.handle.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, event.eventId));
    expect(rows).toHaveLength(0);
  });

  it("RLS: a second tenant reads ZERO outbox/archive rows of the first", async () => {
    const tenantB = randomUUID();
    await t.handle.db.insert(schema.tenants).values({ id: tenantB, name: "tenant-b" });
    const { outboxRows, archiveRows } = await withTenantTx(
      t.handle.db,
      { tenantId: tenantB },
      async (tx) => ({
        outboxRows: await tx.select().from(schema.outbox),
        archiveRows: await tx.select().from(schema.eventArchive),
      }),
    );
    expect(outboxRows).toHaveLength(0);
    expect(archiveRows).toHaveLength(0);
  });

  it("RLS: a context-less app_rw session reads ZERO outbox/archive rows", async () => {
    const { outboxRows, archiveRows } = await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return {
        outboxRows: await tx.select().from(schema.outbox),
        archiveRows: await tx.select().from(schema.eventArchive),
      };
    });
    expect(outboxRows).toHaveLength(0);
    expect(archiveRows).toHaveLength(0);
  });

  it("an app_rw session cannot INSERT into the event archive (relay-only)", async () => {
    await expectPgError(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        tx.execute(sql`
          INSERT INTO platform.event_archive (id, tenant_id, type, event_version, occurred_at, correlation_id, payload)
          VALUES (${randomUUID()}, ${t.tenantId}, 'Forged', 1, now(), 'x', '{}'::jsonb)
        `),
      ),
      /permission denied/,
    );
  });
});

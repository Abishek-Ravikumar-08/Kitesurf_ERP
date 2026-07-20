import { EXPECTED_SCHEMA_VERSION, makeDb, runMigrations, schema, withTenantTx } from "@erp/db";
import { asTenantId, createEvent } from "@erp/kernel";
import { appendOutbox } from "@erp/platform";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkerModule } from "./worker.module.js";

describe("worker (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;
  let tenantId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
    await runMigrations(handle.db);
    tenantId = crypto.randomUUID();
    await handle.db.insert(schema.tenants).values({ id: tenantId, name: "worker-test-tenant" });
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  async function bootWorker(): Promise<TestingModule> {
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.RELAY_INTERVAL_MS = "200"; // fast drain for the e2e test
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await mod.init(); // runs onApplicationBootstrap (boot gate + relay start)
    return mod;
  }

  it("boots against a migrated database and shuts down cleanly", async () => {
    const mod = await bootWorker();
    await mod.close(); // triggers onApplicationShutdown (timer, boss, pool released)
  });

  it("REFUSES to boot on a schema-version mismatch (fail-closed boot gate)", async () => {
    await handle.pool.query("UPDATE platform_meta SET schema_version = $1 WHERE id = 1", [
      EXPECTED_SCHEMA_VERSION + 99,
    ]);
    try {
      await expect(bootWorker()).rejects.toThrow(/schema version mismatch/);
    } finally {
      await runMigrations(handle.db); // restore for the other tests
    }
  });

  it("drains an appended outbox event end-to-end (relayed + archived)", async () => {
    const mod = await bootWorker();
    try {
      const event = createEvent({
        type: "TestThingHappened",
        eventVersion: 1,
        tenantId: asTenantId(tenantId),
        actor: null,
        payload: { via: "worker-e2e" },
        occurredAt: new Date(),
      });
      await withTenantTx(handle.db, { tenantId }, (tx) => appendOutbox(tx, event));

      // Poll until the background relay tick has drained the row (≤ 5s).
      // NOTE: raw pg pool, not drizzle's `sql` — drizzle-orm is not (and must not become)
      // a dependency of the worker; @erp/db owns all drizzle usage.
      const deadline = Date.now() + 5_000;
      let relayed = false;
      let archived = false;
      while (Date.now() < deadline && !(relayed && archived)) {
        const outboxRes = await handle.pool.query(
          "SELECT relayed_at FROM platform.outbox WHERE id = $1",
          [event.eventId],
        );
        relayed = outboxRes.rows[0]?.relayed_at != null;
        const archiveRes = await handle.pool.query(
          "SELECT 1 FROM platform.event_archive WHERE id = $1",
          [event.eventId],
        );
        archived = archiveRes.rowCount === 1;
        if (!(relayed && archived)) await new Promise((r) => setTimeout(r, 100));
      }
      expect(relayed).toBe(true);
      expect(archived).toBe(true);
    } finally {
      await mod.close();
    }
  });
});

import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { tenants } from "./schema/tenancy.js";
import { withTenantTx } from "./tenant-tx.js";

describe("RLS is always-on and fail-closed", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
    await runMigrations(handle.db);
    // bootstrap path: superuser inserts tenants (deliberate RLS bypass)
    await handle.db.insert(tenants).values([
      { id: tenantA, name: "A" },
      { id: tenantB, name: "B" },
    ]);
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  it("a context-less app_rw session reads ZERO rows", async () => {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return tx.select().from(tenants);
    });
    expect(rows).toHaveLength(0);
  });

  it("an empty-string tenant context reads ZERO rows (no cast error)", async () => {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`SET LOCAL ROLE app_rw`);
      return tx.select().from(tenants);
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant A sees exactly its own row, never B's", async () => {
    const rows = await withTenantTx(handle.db, { tenantId: tenantA }, (tx) =>
      tx.select().from(tenants),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tenantA);
  });

  it("a write without tenant context is REJECTED", async () => {
    const err = await handle.db
      .transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE app_rw`);
        await tx.insert(tenants).values({ id: randomUUID(), name: "intruder" });
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeTruthy();
    // drizzle >= 0.44 wraps driver errors (DrizzleQueryError) — match the ROOT cause message
    const msg = String((err as { cause?: Error }).cause?.message ?? (err as Error).message);
    expect(msg).toMatch(/row-level security/i);
  });

  it("SET LOCAL context does NOT leak across transactions on a pooled connection", async () => {
    await withTenantTx(handle.db, { tenantId: tenantA }, (tx) => tx.select().from(tenants));
    const after = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`);
      return tx.select().from(tenants);
    });
    expect(after).toHaveLength(0);
  });

  it("ENABLE + FORCE row security are set on EVERY tenant table (catalog assertion)", async () => {
    // Proves FORCE is really active (test connections are superuser, which bypasses RLS —
    // without this check the FORCE claim would rest on migration review alone). Scans all
    // owner-named schemas so tables added by later tasks are covered automatically.
    const res = await handle.db.execute(sql`
      SELECT n.nspname || '.' || c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('platform', 'md', 'wh', 'fin')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `);
    expect(res.rows).toEqual([]);
  });
});

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { fiscalPeriods } from "./schema/fiscal.js";
import { materials } from "./schema/masterdata.js";
import { numberRanges } from "./schema/numbering.js";
import { stockItems } from "./schema/stock.js";
import { tenants } from "./schema/tenancy.js";
import { DEV_MATERIAL_IDS, DEV_TENANT_ID, seedBaseline } from "./seed.js";
import { withTenantTx } from "./tenant-tx.js";

/** Superuser row counts across every seeded table (RLS bypassed on purpose — audit view). */
async function counts(db: ReturnType<typeof makeDb>["db"]) {
  const [t, m, s, nr, fp] = await Promise.all([
    db.select().from(tenants),
    db.select().from(materials),
    db.select().from(stockItems),
    db.select().from(numberRanges),
    db.select().from(fiscalPeriods),
  ]);
  return {
    tenants: t.length,
    materials: m.length,
    stockItems: s.length,
    numberRanges: nr.length,
    fiscalPeriods: fp.length,
  };
}

describe("deterministic baseline seed (idempotent, RLS-compatible)", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
    await runMigrations(handle.db);
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  it("creates the full dev baseline with fixed identifiers", async () => {
    await seedBaseline(handle.db);

    expect(DEV_TENANT_ID).toBe("00000000-0000-7000-8000-000000000001");
    const tenantRows = await handle.db.select().from(tenants);
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]?.id).toBe(DEV_TENANT_ID);
    expect(tenantRows[0]?.name).toBe("dev");

    const materialRows = await handle.db.select().from(materials).orderBy(materials.sku);
    expect(materialRows.map((m) => m.sku)).toEqual(["BAR-55", "BOARD-136", "KITE-12M"]);
    for (const m of materialRows) {
      expect(m.tenantId).toBe(DEV_TENANT_ID);
      expect(m.baseUom).toBe("EA");
      expect(m.name.length).toBeGreaterThan(0);
    }

    const stockRows = await handle.db.select().from(stockItems);
    expect(stockRows).toHaveLength(3);
    const materialIds = new Set(materialRows.map((m) => m.id));
    for (const s of stockRows) {
      expect(s.tenantId).toBe(DEV_TENANT_ID);
      expect(materialIds.has(s.materialId)).toBe(true);
      expect(s.onHand).toBe("100.000000");
      expect(s.reserved).toBe("0.000000");
    }

    const rangeRows = await handle.db.select().from(numberRanges).orderBy(numberRanges.rangeKey);
    expect(rangeRows).toEqual([
      expect.objectContaining({
        tenantId: DEV_TENANT_ID,
        rangeKey: "INV",
        period: "2026",
        prefix: "INV-2026-",
        padTo: 6,
        currentValue: 0,
      }),
      expect.objectContaining({
        tenantId: DEV_TENANT_ID,
        rangeKey: "SO",
        period: "2026",
        prefix: "SO-2026-",
        padTo: 6,
        currentValue: 0,
      }),
    ]);

    const periodRows = await handle.db.select().from(fiscalPeriods).orderBy(fiscalPeriods.period);
    expect(periodRows).toHaveLength(12);
    expect(periodRows.map((p) => p.period)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const p of periodRows) {
      expect(p.tenantId).toBe(DEV_TENANT_ID);
      expect(p.year).toBe(2026);
      expect(p.status).toBe("open");
      expect(p.startsOn <= p.endsOn).toBe(true);
    }
  });

  it("is idempotent: a second run changes nothing and throws no duplicate-key errors", async () => {
    const before = await counts(handle.db);
    const beforeMaterials = await handle.db.select().from(materials).orderBy(materials.sku);

    await expect(seedBaseline(handle.db)).resolves.toBeUndefined();

    const after = await counts(handle.db);
    expect(after).toEqual(before);
    expect(after).toEqual({
      tenants: 1,
      materials: 3,
      stockItems: 3,
      numberRanges: 2,
      fiscalPeriods: 12,
    });

    // Key fields stable — same ids, skus, names as the first run.
    const afterMaterials = await handle.db.select().from(materials).orderBy(materials.sku);
    expect(afterMaterials.map((m) => ({ id: m.id, sku: m.sku, name: m.name }))).toEqual(
      beforeMaterials.map((m) => ({ id: m.id, sku: m.sku, name: m.name })),
    );
  });

  it("never clobbers live data: superuser edits to seeded rows survive a re-run", async () => {
    // Pins the onConflictDoNothing contract: a drive-by switch to onConflictDoUpdate would
    // pass every other test here while silently destroying live-DB state on re-seed.
    await handle.db
      .update(numberRanges)
      .set({ currentValue: 7 })
      .where(
        and(
          eq(numberRanges.tenantId, DEV_TENANT_ID),
          eq(numberRanges.rangeKey, "SO"),
          eq(numberRanges.period, "2026"),
        ),
      );
    await handle.db
      .update(fiscalPeriods)
      .set({ status: "closed" })
      .where(
        and(
          eq(fiscalPeriods.tenantId, DEV_TENANT_ID),
          eq(fiscalPeriods.year, 2026),
          eq(fiscalPeriods.period, 7),
        ),
      );
    const [kiteStock] = await handle.db
      .select()
      .from(stockItems)
      .where(eq(stockItems.materialId, DEV_MATERIAL_IDS["KITE-12M"]));
    if (!kiteStock) throw new Error("expected seeded KITE-12M stock item");
    await handle.db
      .update(stockItems)
      .set({ onHand: "250" })
      .where(eq(stockItems.id, kiteStock.id));

    await expect(seedBaseline(handle.db)).resolves.toBeUndefined();

    const [soRange] = await handle.db
      .select()
      .from(numberRanges)
      .where(
        and(
          eq(numberRanges.tenantId, DEV_TENANT_ID),
          eq(numberRanges.rangeKey, "SO"),
          eq(numberRanges.period, "2026"),
        ),
      );
    expect(soRange?.currentValue).toBe(7);

    const [july] = await handle.db
      .select()
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.tenantId, DEV_TENANT_ID),
          eq(fiscalPeriods.year, 2026),
          eq(fiscalPeriods.period, 7),
        ),
      );
    expect(july?.status).toBe("closed");

    const [kiteAfter] = await handle.db
      .select()
      .from(stockItems)
      .where(eq(stockItems.id, kiteStock.id));
    expect(kiteAfter?.onHand).toBe("250.000000");
  });

  it("seeded rows are visible under withTenantTx for the dev tenant (RLS-compatible)", async () => {
    const { tenantRows, kite } = await withTenantTx(
      handle.db,
      { tenantId: DEV_TENANT_ID },
      async (tx) => {
        const tRows = await tx.select().from(tenants);
        const mRows = await tx.select().from(materials).where(sql`${materials.sku} = 'KITE-12M'`);
        return { tenantRows: tRows, kite: mRows };
      },
    );
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]?.id).toBe(DEV_TENANT_ID);
    expect(kite).toHaveLength(1);
    expect(kite[0]?.tenantId).toBe(DEV_TENANT_ID);
  });
});

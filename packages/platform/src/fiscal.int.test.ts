import { randomUUID } from "node:crypto";
import { schema, withTenantTx } from "@erp/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PeriodClosedError,
  PeriodNotClosedError,
  PeriodNotOpenError,
  VersionConflictError,
} from "./errors.js";
import { assertPeriodOpen, closePeriod, createPeriod, reopenPeriod } from "./fiscal.js";
import { adjustOnHand } from "./stock.js";
import { type TestDb, expectPgError, inParallel, startTestDb } from "./testkit.js";

/** Calendar month bounds as YYYY-MM-DD strings (deterministic, UTC-safe). */
function monthBounds(year: number, month: number): { startsOn: string; endsOn: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startsOn: `${year}-${mm}-01`,
    endsOn: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Create the 12 monthly periods of `year` for a tenant; returns periodId by period number. */
async function createYearPeriods(
  t: TestDb,
  tenantId: string,
  year: number,
): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  for (let p = 1; p <= 12; p++) {
    const { startsOn, endsOn } = monthBounds(year, p);
    const { periodId } = await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      createPeriod(tx, { tenantId, year, period: p, startsOn, endsOn, actor: null }),
    );
    ids.set(p, periodId);
  }
  return ids;
}

async function newTenant(t: TestDb): Promise<string> {
  const tenantId = randomUUID();
  await t.handle.db
    .insert(schema.tenants)
    .values({ id: tenantId, name: `t-${tenantId.slice(0, 8)}` });
  return tenantId;
}

async function periodRow(t: TestDb, periodId: string) {
  const [row] = await t.handle.db
    .select()
    .from(schema.fiscalPeriods)
    .where(eq(schema.fiscalPeriods.id, periodId));
  if (!row) throw new Error(`fiscal period ${periodId} not found`);
  return row;
}

async function auditRows(t: TestDb, aggregateId: string, action: string) {
  return t.handle.db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.aggregateId, aggregateId), eq(schema.auditLog.action, action)));
}

async function outboxRows(t: TestDb, type: string, periodId: string) {
  const res = await t.handle.db.execute(sql`
    SELECT * FROM platform.outbox WHERE type = ${type} AND payload->>'periodId' = ${periodId}
  `);
  return res.rows;
}

/** Seed a material + stock item for an arbitrary tenant (superuser bootstrap path). */
async function seedItemFor(t: TestDb, tenantId: string, onHand: string): Promise<string> {
  const materialId = randomUUID();
  await t.handle.db.insert(schema.materials).values({
    id: materialId,
    tenantId,
    sku: `SKU-${materialId.slice(0, 8)}`,
    name: "test material",
    baseUom: "EA",
  });
  const itemId = randomUUID();
  await t.handle.db.insert(schema.stockItems).values({
    id: itemId,
    tenantId,
    materialId,
    onHand,
  });
  return itemId;
}

describe("fiscal calendar + period-close posting gate", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });

  it("create + gate happy path: 12 audited periods, assertPeriodOpen resolves", async () => {
    const ids = await createYearPeriods(t, t.tenantId, 2026);
    expect(ids.size).toBe(12);

    const rows = await t.handle.db
      .select()
      .from(schema.fiscalPeriods)
      .where(eq(schema.fiscalPeriods.tenantId, t.tenantId));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.status === "open" && r.version === 1)).toBe(true);

    const julyId = ids.get(7);
    if (!julyId) throw new Error("period 7 missing");
    const audits = await auditRows(t, julyId, "fiscal.create-period");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.aggregateType).toBe("FiscalPeriod");
    // registry/setup write → NO outbox event
    expect(await outboxRows(t, "FiscalPeriodClosed", julyId)).toHaveLength(0);

    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        assertPeriodOpen(tx, t.tenantId, "2026-07-15"),
      ),
    ).resolves.toBeUndefined();
  });

  it("closed period blocks: audit + event on close, then PeriodClosedError", async () => {
    const tenantId = await newTenant(t);
    const ids = await createYearPeriods(t, tenantId, 2026);
    const julyId = ids.get(7);
    if (!julyId) throw new Error("period 7 missing");

    await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      closePeriod(tx, { tenantId, periodId: julyId, expectedVersion: 1, actor: null }),
    );

    const row = await periodRow(t, julyId);
    expect(row.status).toBe("closed");
    expect(row.version).toBe(2);
    expect(row.closedAt).toBeTruthy();

    expect(await auditRows(t, julyId, "fiscal.close-period")).toHaveLength(1);
    const events = await outboxRows(t, "FiscalPeriodClosed", julyId);
    expect(events).toHaveLength(1);
    expect((events[0] as { payload: { year: number; period: number } }).payload).toMatchObject({
      periodId: julyId,
      year: 2026,
      period: 7,
    });

    await expect(
      withTenantTx(t.handle.db, { tenantId }, (tx) => assertPeriodOpen(tx, tenantId, "2026-07-15")),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });

  it("missing period fails closed: PeriodNotOpenError", async () => {
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        assertPeriodOpen(tx, t.tenantId, "2031-01-01"),
      ),
    ).rejects.toBeInstanceOf(PeriodNotOpenError);
  });

  it("boundary dates: startsOn and endsOn are IN the period (inclusive)", async () => {
    for (const d of ["2026-03-01", "2026-03-31"]) {
      await expect(
        withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
          assertPeriodOpen(tx, t.tenantId, d),
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("overlap rejected by the DB exclusion constraint", async () => {
    const tenantId = await newTenant(t);
    await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      createPeriod(tx, {
        tenantId,
        year: 2026,
        period: 7,
        startsOn: "2026-07-01",
        endsOn: "2026-07-31",
        actor: null,
      }),
    );
    // endsOn of 7 == startsOn of this one → overlaps under the inclusive '[]' daterange
    await expectPgError(
      withTenantTx(t.handle.db, { tenantId }, (tx) =>
        createPeriod(tx, {
          tenantId,
          year: 2026,
          period: 8,
          startsOn: "2026-07-31",
          endsOn: "2026-08-30",
          actor: null,
        }),
      ),
      /fiscal_periods_no_overlap/,
    );
  });

  it("concurrent close: exactly one winner; reopen restores (audited + event)", async () => {
    const tenantId = await newTenant(t);
    const ids = await createYearPeriods(t, tenantId, 2026);
    const julyId = ids.get(7);
    if (!julyId) throw new Error("period 7 missing");

    const results = await inParallel(
      Array.from(
        { length: 2 },
        () => () =>
          withTenantTx(t.handle.db, { tenantId }, (tx) =>
            closePeriod(tx, { tenantId, periodId: julyId, expectedVersion: 1, actor: null }),
          ),
      ),
    );
    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]?.reason).toBeInstanceOf(VersionConflictError);

    let row = await periodRow(t, julyId);
    expect(row.status).toBe("closed");
    expect(row.version).toBe(2);
    expect(await auditRows(t, julyId, "fiscal.close-period")).toHaveLength(1);
    expect(await outboxRows(t, "FiscalPeriodClosed", julyId)).toHaveLength(1);

    await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      reopenPeriod(tx, { tenantId, periodId: julyId, expectedVersion: 2, actor: null }),
    );
    row = await periodRow(t, julyId);
    expect(row.status).toBe("open");
    expect(row.version).toBe(3);
    expect(row.closedAt).toBeNull();
    expect(row.closedBy).toBeNull();
    expect(await auditRows(t, julyId, "fiscal.reopen-period")).toHaveLength(1);
    expect(await outboxRows(t, "FiscalPeriodReopened", julyId)).toHaveLength(1);

    // reopening an already-open period is a typed error, not PeriodNotOpenError
    await expect(
      withTenantTx(t.handle.db, { tenantId }, (tx) =>
        reopenPeriod(tx, { tenantId, periodId: julyId, expectedVersion: 3, actor: null }),
      ),
    ).rejects.toBeInstanceOf(PeriodNotClosedError);
  });

  it("the gate is WIRED: adjustOnHand passes on open, throws PeriodClosedError after close", async () => {
    const tenantId = await newTenant(t);
    const ids = await createYearPeriods(t, tenantId, 2026);
    const julyId = ids.get(7);
    if (!julyId) throw new Error("period 7 missing");
    const itemId = await seedItemFor(t, tenantId, "100");

    await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      adjustOnHand(tx, {
        tenantId,
        stockItemId: itemId,
        delta: "5",
        reason: "cycle count",
        postingDate: "2026-07-15",
        actor: null,
      }),
    );
    let [item] = await t.handle.db
      .select()
      .from(schema.stockItems)
      .where(eq(schema.stockItems.id, itemId));
    expect(Number(item?.onHand)).toBe(105);

    await withTenantTx(t.handle.db, { tenantId }, (tx) =>
      closePeriod(tx, { tenantId, periodId: julyId, expectedVersion: 1, actor: null }),
    );

    await expect(
      withTenantTx(t.handle.db, { tenantId }, (tx) =>
        adjustOnHand(tx, {
          tenantId,
          stockItemId: itemId,
          delta: "5",
          reason: "cycle count",
          postingDate: "2026-07-15",
          actor: null,
        }),
      ),
    ).rejects.toBeInstanceOf(PeriodClosedError);

    // blocked posting wrote NOTHING
    [item] = await t.handle.db
      .select()
      .from(schema.stockItems)
      .where(eq(schema.stockItems.id, itemId));
    expect(Number(item?.onHand)).toBe(105);
    expect(await auditRows(t, itemId, "stock.adjust")).toHaveLength(1);
  });

  it("RLS: tenant B and context-less sessions see ZERO fiscal periods", async () => {
    const tenantB = await newTenant(t);
    const asB = await withTenantTx(t.handle.db, { tenantId: tenantB }, (tx) =>
      tx.select().from(schema.fiscalPeriods),
    );
    expect(asB).toHaveLength(0);

    const contextless = await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return tx.select().from(schema.fiscalPeriods);
    });
    expect(contextless).toHaveLength(0);
  });
});

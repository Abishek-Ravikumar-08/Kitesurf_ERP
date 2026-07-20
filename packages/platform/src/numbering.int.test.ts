import { schema, withTenantTx } from "@erp/db";
import { and, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NumberRangeNotFoundError } from "./errors.js";
import { allocateNumber, createRange, detectGaps } from "./numbering.js";
import { type TestDb, inParallel, startTestDb } from "./testkit.js";

async function rangeRow(t: TestDb, rangeKey: string, period: string) {
  const [row] = await t.handle.db
    .select()
    .from(schema.numberRanges)
    .where(
      and(
        eq(schema.numberRanges.tenantId, t.tenantId),
        eq(schema.numberRanges.rangeKey, rangeKey),
        eq(schema.numberRanges.period, period),
      ),
    );
  return row;
}

async function journalRows(t: TestDb, rangeKey: string, period: string) {
  return t.handle.db
    .select()
    .from(schema.numberAllocations)
    .where(
      and(
        eq(schema.numberAllocations.tenantId, t.tenantId),
        eq(schema.numberAllocations.rangeKey, rangeKey),
        eq(schema.numberAllocations.period, period),
      ),
    );
}

describe("gapless number ranges", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });

  it("sequential allocation + formatting; createRange is audited", async () => {
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      createRange(tx, {
        tenantId: t.tenantId,
        rangeKey: "INV",
        period: "2026",
        prefix: "INV-2026-",
        padTo: 6,
        actor: null,
      }),
    );

    const audits = await t.handle.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aggregateId, "INV:2026"),
          eq(schema.auditLog.action, "numbering.create-range"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.aggregateType).toBe("NumberRange");

    const results: Array<{ value: number; formatted: string }> = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
          allocateNumber(tx, { tenantId: t.tenantId, rangeKey: "INV", period: "2026" }),
        ),
      );
    }
    expect(results.map((r) => r.value)).toEqual([1, 2, 3]);
    expect(results.map((r) => r.formatted)).toEqual([
      "INV-2026-000001",
      "INV-2026-000002",
      "INV-2026-000003",
    ]);
  });

  it("unknown range throws NumberRangeNotFoundError", async () => {
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        allocateNumber(tx, { tenantId: t.tenantId, rangeKey: "NOPE", period: "" }),
      ),
    ).rejects.toBeInstanceOf(NumberRangeNotFoundError);
  });

  it("property: 100 concurrent allocations are dense and duplicate-free", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 40, max: 100 }), async (n) => {
        const rangeKey = `R${crypto.randomUUID().slice(0, 8)}`;
        await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
          createRange(tx, { tenantId: t.tenantId, rangeKey, period: "", actor: null }),
        );
        const results = await inParallel(
          Array.from(
            { length: n },
            (_, i) => () =>
              withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
                allocateNumber(tx, {
                  tenantId: t.tenantId,
                  rangeKey,
                  period: "",
                  docRef: `doc-${i}`,
                }),
              ),
          ),
        );
        if (results.some((r) => r.status === "rejected")) return false;
        const values = results
          .map((r) => (r as PromiseFulfilledResult<{ value: number }>).value.value)
          .sort((a, b) => a - b);
        const dense = values.every((v, i) => v === i + 1);
        const gaps = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
          detectGaps(tx, { tenantId: t.tenantId, rangeKey, period: "" }),
        );
        return dense && values.length === n && gaps.length === 0;
      }),
      { numRuns: 10 },
    );
  });

  it("per-(range, period) isolation: concurrent allocations on distinct series stay dense", async () => {
    // Two distinct series: different rangeKey AND same rangeKey with a different period.
    const series: Array<{ rangeKey: string; period: string }> = [
      { rangeKey: "ISO-A", period: "" },
      { rangeKey: "ISO-A", period: "2026" },
      { rangeKey: "ISO-B", period: "" },
    ];
    for (const s of series) {
      await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        createRange(tx, {
          tenantId: t.tenantId,
          rangeKey: s.rangeKey,
          period: s.period,
          actor: null,
        }),
      );
    }
    const n = 20;
    // Interleave all three series' allocations in ONE parallel batch.
    const thunks = series.flatMap((s) =>
      Array.from(
        { length: n },
        () => () =>
          withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
            allocateNumber(tx, { tenantId: t.tenantId, rangeKey: s.rangeKey, period: s.period }),
          ),
      ),
    );
    const results = await inParallel(thunks);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    for (const [si, s] of series.entries()) {
      const values = results
        .slice(si * n, (si + 1) * n)
        .map((r) => (r as PromiseFulfilledResult<{ value: number }>).value.value)
        .sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      const gaps = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        detectGaps(tx, { tenantId: t.tenantId, rangeKey: s.rangeKey, period: s.period }),
      );
      expect(gaps).toEqual([]);
    }
  });

  it("rollback leaves NO gap (counter rolls back); a committed-then-lost allocation is a DETECTED gap", async () => {
    const rangeKey = "GAP";
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      createRange(tx, { tenantId: t.tenantId, rangeKey, period: "", actor: null }),
    );

    // 1) In-tx rollback: the counter increment AND the journal row roll back together —
    //    honest consequence: an aborted business tx leaves no trace and no gap.
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, async (tx) => {
        await allocateNumber(tx, { tenantId: t.tenantId, rangeKey, period: "" });
        throw new Error("business validation failed AFTER allocation");
      }),
    ).rejects.toThrow(/business validation failed/);
    expect((await rangeRow(t, rangeKey, ""))?.currentValue).toBe(0);
    expect(await journalRows(t, rangeKey, "")).toHaveLength(0);
    let gaps = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      detectGaps(tx, { tenantId: t.tenantId, rangeKey, period: "" }),
    );
    expect(gaps).toEqual([]);

    // 2) Journal/counter divergence: deleting a committed journal row as superuser (RLS
    //    bypass, bootstrap path) models an out-of-band counter bump, journal corruption, or a
    //    future flow that allocates in a separately committed tx (e.g. Phase-5 SAP
    //    provisional-adopt). detectGaps detects exactly these journal holes — that is what
    //    "gaps are DETECTED, not prevented" means. NOTE it does NOT model a lost document:
    //    under the single-tx convention a lost document leaves the journal row intact
    //    (dangling docRef), which detectGaps would NOT flag — a lost-document audit would
    //    need a dangling-docRef check instead.
    for (let i = 0; i < 2; i++) {
      await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        allocateNumber(tx, { tenantId: t.tenantId, rangeKey, period: "" }),
      );
    }
    expect((await rangeRow(t, rangeKey, ""))?.currentValue).toBe(2);
    await t.handle.db
      .delete(schema.numberAllocations)
      .where(
        and(
          eq(schema.numberAllocations.tenantId, t.tenantId),
          eq(schema.numberAllocations.rangeKey, rangeKey),
          eq(schema.numberAllocations.value, 1),
        ),
      );
    gaps = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      detectGaps(tx, { tenantId: t.tenantId, rangeKey, period: "" }),
    );
    expect(gaps).toEqual([1]);
  });

  it("RLS: tenant B and context-less sessions see ZERO numbering rows", async () => {
    const rangeKey = "RLS";
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, async (tx) => {
      await createRange(tx, { tenantId: t.tenantId, rangeKey, period: "", actor: null });
      await allocateNumber(tx, { tenantId: t.tenantId, rangeKey, period: "" });
    });

    const tenantB = crypto.randomUUID();
    await t.handle.db.insert(schema.tenants).values({ id: tenantB, name: "tenant-b" });
    const asB = await withTenantTx(t.handle.db, { tenantId: tenantB }, async (tx) => ({
      ranges: await tx.select().from(schema.numberRanges),
      allocations: await tx.select().from(schema.numberAllocations),
    }));
    expect(asB.ranges).toHaveLength(0);
    expect(asB.allocations).toHaveLength(0);

    const contextless = await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return {
        ranges: await tx.select().from(schema.numberRanges),
        allocations: await tx.select().from(schema.numberAllocations),
      };
    });
    expect(contextless.ranges).toHaveLength(0);
    expect(contextless.allocations).toHaveLength(0);
  });
});

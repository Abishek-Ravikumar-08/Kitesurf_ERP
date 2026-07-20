import { randomUUID } from "node:crypto";
import { schema, withTenantTx } from "@erp/db";
import { asTenantId, createEvent } from "@erp/kernel";
import { and, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  InvalidEventPayloadError,
  InvalidQuantityError,
  ReservationNotActiveError,
} from "./errors.js";
import { appendOutbox } from "./outbox.js";
import { consume, getAvailable, release, reserve } from "./stock.js";
import { type TestDb, inParallel, startTestDb } from "./testkit.js";

/** Seed a fresh material + stock item on the superuser handle (bootstrap path, bypasses RLS). */
async function seedItem(
  t: TestDb,
  onHand: string,
  opts: { allowNegative?: boolean } = {},
): Promise<string> {
  const materialId = randomUUID();
  await t.handle.db.insert(schema.materials).values({
    id: materialId,
    tenantId: t.tenantId,
    sku: `SKU-${materialId.slice(0, 8)}`,
    name: "test material",
    baseUom: "EA",
  });
  const itemId = randomUUID();
  await t.handle.db.insert(schema.stockItems).values({
    id: itemId,
    tenantId: t.tenantId,
    materialId,
    onHand,
    allowNegative: opts.allowNegative ?? false,
  });
  return itemId;
}

async function getItem(t: TestDb, itemId: string) {
  const [row] = await t.handle.db
    .select()
    .from(schema.stockItems)
    .where(eq(schema.stockItems.id, itemId));
  if (!row) throw new Error(`stock item ${itemId} not found`);
  return row;
}

/** Sum of qty over ACTIVE ledger rows for one item (superuser handle). */
async function activeLedgerSum(t: TestDb, itemId: string): Promise<number> {
  const res = await t.handle.db.execute(sql`
    SELECT COALESCE(SUM(qty), 0)::text AS total FROM wh.stock_reservations
    WHERE stock_item_id = ${itemId} AND status = 'active'
  `);
  return Number((res.rows[0] as { total: string }).total);
}

async function auditRows(t: TestDb, itemId: string, action: string) {
  return t.handle.db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.aggregateId, itemId), eq(schema.auditLog.action, action)));
}

async function outboxRows(t: TestDb, type: string, itemId: string) {
  const res = await t.handle.db.execute(sql`
    SELECT * FROM platform.outbox WHERE type = ${type} AND payload->>'stockItemId' = ${itemId}
  `);
  return res.rows;
}

describe("stock reservation / ATP", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });

  it("reserve happy path: counter + ledger + audit + outbox in ONE tx", async () => {
    const itemId = await seedItem(t, "100");
    const { reservationId } = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "30",
        kind: "hard",
        actor: null,
      }),
    );
    expect(reservationId).toBeTruthy();

    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(30);
    expect(Number(item.onHand)).toBe(100);

    const ledger = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.stockItemId, itemId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.status).toBe("active");
    expect(Number(ledger[0]?.qty)).toBe(30);
    expect(ledger[0]?.kind).toBe("hard");

    const audits = await auditRows(t, itemId, "stock.reserve");
    expect(audits).toHaveLength(1);

    const events = await outboxRows(t, "StockReserved", itemId);
    expect(events).toHaveLength(1);
  });

  it("oversell is rejected: InsufficientStockError, no partial writes", async () => {
    const itemId = await seedItem(t, "100");
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "30",
        kind: "hard",
        actor: null,
      }),
    );
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        reserve(tx, {
          tenantId: t.tenantId,
          stockItemId: itemId,
          qty: "80",
          kind: "hard",
          actor: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(30);
    const ledger = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.stockItemId, itemId));
    expect(ledger).toHaveLength(1);
    expect(await auditRows(t, itemId, "stock.reserve")).toHaveLength(1);
    expect(await outboxRows(t, "StockReserved", itemId)).toHaveLength(1);
  });

  it("allow_negative: reserving beyond on-hand is accepted", async () => {
    const itemId = await seedItem(t, "10", { allowNegative: true });
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "25",
        kind: "soft",
        actor: null,
      }),
    );
    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(25);
  });

  it("release returns qty to available; consume decrements reserved AND on_hand", async () => {
    const itemId = await seedItem(t, "100");
    const r1 = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "40",
        kind: "hard",
        actor: null,
      }),
    );
    const r2 = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "25",
        kind: "hard",
        actor: null,
      }),
    );

    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      release(tx, { tenantId: t.tenantId, reservationId: r1.reservationId, actor: null }),
    );
    let item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(25);
    expect(Number(item.onHand)).toBe(100);
    const [released] = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.id, r1.reservationId));
    expect(released?.status).toBe("released");
    expect(released?.releasedAt).toBeTruthy();
    expect(await auditRows(t, itemId, "stock.release")).toHaveLength(1);
    expect(await outboxRows(t, "StockReservationReleased", itemId)).toHaveLength(1);

    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      consume(tx, { tenantId: t.tenantId, reservationId: r2.reservationId, actor: null }),
    );
    item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(0);
    expect(Number(item.onHand)).toBe(75);
    const [consumed] = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.id, r2.reservationId));
    expect(consumed?.status).toBe("consumed");
    expect(await auditRows(t, itemId, "stock.consume")).toHaveLength(1);
    expect(await outboxRows(t, "StockReservationConsumed", itemId)).toHaveLength(1);
  });

  it("double release: second release throws ReservationNotActiveError, counters unchanged", async () => {
    const itemId = await seedItem(t, "100");
    const r = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "10",
        kind: "hard",
        actor: null,
      }),
    );
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      release(tx, { tenantId: t.tenantId, reservationId: r.reservationId, actor: null }),
    );
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        release(tx, { tenantId: t.tenantId, reservationId: r.reservationId, actor: null }),
      ),
    ).rejects.toBeInstanceOf(ReservationNotActiveError);
    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(0);
    expect(Number(item.onHand)).toBe(100);
    // exactly one release audit/event — the failed second call wrote nothing
    expect(await auditRows(t, itemId, "stock.release")).toHaveLength(1);
    expect(await outboxRows(t, "StockReservationReleased", itemId)).toHaveLength(1);
  });

  it('reserve with qty "-5" throws InvalidQuantityError before touching SQL, nothing written', async () => {
    const itemId = await seedItem(t, "100");
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        reserve(tx, {
          tenantId: t.tenantId,
          stockItemId: itemId,
          qty: "-5",
          kind: "hard",
          actor: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidQuantityError);
    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(0);
    const ledger = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.stockItemId, itemId));
    expect(ledger).toHaveLength(0);
    expect(await auditRows(t, itemId, "stock.reserve")).toHaveLength(0);
    expect(await outboxRows(t, "StockReserved", itemId)).toHaveLength(0);
  });

  it('reserve with qty "abc" throws InvalidQuantityError before touching SQL, nothing written', async () => {
    const itemId = await seedItem(t, "100");
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        reserve(tx, {
          tenantId: t.tenantId,
          stockItemId: itemId,
          qty: "abc",
          kind: "hard",
          actor: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidQuantityError);
    const item = await getItem(t, itemId);
    expect(Number(item.reserved)).toBe(0);
    const ledger = await t.handle.db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.stockItemId, itemId));
    expect(ledger).toHaveLength(0);
    expect(await auditRows(t, itemId, "stock.reserve")).toHaveLength(0);
    expect(await outboxRows(t, "StockReserved", itemId)).toHaveLength(0);
  });

  it("getAvailable = on_hand - reserved", async () => {
    const itemId = await seedItem(t, "50");
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "20",
        kind: "soft",
        actor: null,
      }),
    );
    const available = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      getAvailable(tx, itemId),
    );
    expect(typeof available).toBe("string");
    expect(Number(available)).toBe(30);
  });

  it("property: N concurrent reserves — no oversell, ledger sum == reserved counter", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 20, max: 120 }),
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 6, maxLength: 10 }),
        async (onHand, qtys) => {
          const itemId = await seedItem(t, String(onHand)); // fresh item per run
          const results = await inParallel(
            qtys.map(
              (q) => () =>
                withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
                  reserve(tx, {
                    tenantId: t.tenantId,
                    stockItemId: itemId,
                    qty: String(q),
                    kind: "hard",
                    actor: null,
                  }),
                ),
            ),
          );
          const failed = results.filter((r) => r.status === "rejected");
          for (const f of failed)
            if (!/insufficient stock/i.test(String((f as PromiseRejectedResult).reason)))
              return false;
          const item = await getItem(t, itemId);
          const ledgerSum = await activeLedgerSum(t, itemId);
          const reservedOk = Number(item.reserved) <= onHand && Number(item.reserved) === ledgerSum;
          const successSum = qtys
            .filter((_, i) => results[i]?.status === "fulfilled")
            .reduce((a, b) => a + b, 0);
          // NOTE deliberately NO "at least one succeeds" assertion — all-rejected is CORRECT when every qty exceeds on-hand.
          return reservedOk && Number(item.reserved) === successSum;
        },
      ),
      { numRuns: 25 },
    );
  });

  it("RLS: tenant B sees NONE of tenant A's md/wh rows; context-less sees ZERO", async () => {
    const itemId = await seedItem(t, "100");
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      reserve(tx, {
        tenantId: t.tenantId,
        stockItemId: itemId,
        qty: "1",
        kind: "soft",
        actor: null,
      }),
    );
    const tenantB = randomUUID();
    await t.handle.db.insert(schema.tenants).values({ id: tenantB, name: "tenant-b" });

    const asB = await withTenantTx(t.handle.db, { tenantId: tenantB }, async (tx) => ({
      materials: await tx.select().from(schema.materials),
      items: await tx.select().from(schema.stockItems),
      reservations: await tx.select().from(schema.stockReservations),
    }));
    expect(asB.materials).toHaveLength(0);
    expect(asB.items).toHaveLength(0);
    expect(asB.reservations).toHaveLength(0);

    const contextless = await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return {
        materials: await tx.select().from(schema.materials),
        items: await tx.select().from(schema.stockItems),
        reservations: await tx.select().from(schema.stockReservations),
      };
    });
    expect(contextless.materials).toHaveLength(0);
    expect(contextless.items).toHaveLength(0);
    expect(contextless.reservations).toHaveLength(0);
  });

  it("appendOutbox rejects a malformed StockReserved payload and writes NO row", async () => {
    const event = createEvent({
      type: "StockReserved",
      eventVersion: 1,
      tenantId: asTenantId(t.tenantId),
      actor: null,
      occurredAt: new Date(),
      // qty missing → violates the registered v1 schema
      payload: { stockItemId: randomUUID(), materialId: randomUUID(), kind: "hard", ref: null },
    });
    await expect(
      withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) => appendOutbox(tx, event)),
    ).rejects.toBeInstanceOf(InvalidEventPayloadError);
    const res = await t.handle.db.execute(
      sql`SELECT 1 FROM platform.outbox WHERE id = ${event.eventId}`,
    );
    expect(res.rows).toHaveLength(0);
  });
});

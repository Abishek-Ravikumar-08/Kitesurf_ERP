import { type Tx, schema } from "@erp/db";
import { asTenantId, asUserId, createEvent, newId } from "@erp/kernel";
import { and, eq, sql } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import {
  InsufficientStockError,
  InvalidQuantityError,
  ReservationNotActiveError,
  StockItemNotFoundError,
} from "./errors.js";
import { appendOutbox } from "./outbox.js";

const QTY_RE = /^\d+(\.\d+)?$/;
/** Positive decimal string (matches the contracts' qty grammar, sign excluded). */
function assertPositiveQty(qty: string): void {
  if (!QTY_RE.test(qty) || Number(qty) === 0) throw new InvalidQuantityError(qty);
}
const SIGNED_QTY_RE = /^-?\d+(\.\d+)?$/;
/** Signed decimal string (zero allowed — a no-op adjust is legal). */
function assertSignedQty(delta: string): void {
  if (!SIGNED_QTY_RE.test(delta)) throw new InvalidQuantityError(delta);
}

export interface ReserveInput {
  tenantId: string;
  stockItemId: string;
  qty: string;
  kind: "soft" | "hard";
  actor: string | null;
  ref?: string | null;
  correlationId?: string;
}

/** Atomic reservation: serialized decrement via a guarded UPDATE — never an async round-trip (spec §5 rule 3). */
export async function reserve(tx: Tx, input: ReserveInput): Promise<{ reservationId: string }> {
  assertPositiveQty(input.qty);
  const updated = await tx
    .update(schema.stockItems)
    .set({
      reserved: sql`${schema.stockItems.reserved} + ${input.qty}::numeric`,
      version: sql`${schema.stockItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.stockItems.id, input.stockItemId),
        sql`(${schema.stockItems.allowNegative} OR ${schema.stockItems.onHand} - ${schema.stockItems.reserved} >= ${input.qty}::numeric)`,
      ),
    )
    .returning({ materialId: schema.stockItems.materialId });
  const item = updated[0];
  if (!item) {
    const exists = await tx
      .select({ id: schema.stockItems.id })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.id, input.stockItemId));
    if (exists.length === 0) throw new StockItemNotFoundError(input.stockItemId);
    throw new InsufficientStockError(input.stockItemId, input.qty);
  }
  const reservationId = newId();
  await tx.insert(schema.stockReservations).values({
    id: reservationId,
    tenantId: input.tenantId,
    stockItemId: input.stockItemId,
    qty: input.qty,
    kind: input.kind,
    ref: input.ref ?? null,
  });
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "StockItem",
    aggregateId: input.stockItemId,
    action: "stock.reserve",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { reservationId, qty: input.qty, kind: input.kind },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "StockReserved",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: {
        stockItemId: input.stockItemId,
        materialId: item.materialId,
        qty: input.qty,
        kind: input.kind,
        ref: input.ref ?? null,
      },
    }),
  );
  return { reservationId };
}

export interface ReservationTransitionInput {
  tenantId: string;
  reservationId: string;
  actor: string | null;
  correlationId?: string;
}

/**
 * Guarded status transition active → released|consumed; 0 rows → not active.
 * Returns the ledger row's stockItemId + qty for the counter update.
 */
async function transitionReservation(
  tx: Tx,
  input: ReservationTransitionInput,
  to: "released" | "consumed",
): Promise<{ stockItemId: string; qty: string }> {
  const updated = await tx
    .update(schema.stockReservations)
    .set({
      status: to,
      ...(to === "released" ? { releasedAt: sql`now()` } : {}),
    })
    .where(
      and(
        eq(schema.stockReservations.id, input.reservationId),
        eq(schema.stockReservations.status, "active"),
      ),
    )
    .returning({
      stockItemId: schema.stockReservations.stockItemId,
      qty: schema.stockReservations.qty,
    });
  const row = updated[0];
  if (!row) throw new ReservationNotActiveError(input.reservationId);
  return row;
}

/** Release an active reservation: qty returns to available (reserved -= qty). */
export async function release(
  tx: Tx,
  input: ReservationTransitionInput,
): Promise<{ stockItemId: string; qty: string }> {
  const { stockItemId, qty } = await transitionReservation(tx, input, "released");
  await tx
    .update(schema.stockItems)
    .set({
      reserved: sql`${schema.stockItems.reserved} - ${qty}::numeric`,
      version: sql`${schema.stockItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.stockItems.id, stockItemId));
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "StockItem",
    aggregateId: stockItemId,
    action: "stock.release",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { reservationId: input.reservationId, qty },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "StockReservationReleased",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: { reservationId: input.reservationId, stockItemId, qty },
    }),
  );
  return { stockItemId, qty };
}

/** Consume an active reservation: stock leaves the warehouse (reserved -= qty, on_hand -= qty). */
export async function consume(
  tx: Tx,
  input: ReservationTransitionInput,
): Promise<{ stockItemId: string; qty: string }> {
  const { stockItemId, qty } = await transitionReservation(tx, input, "consumed");
  await tx
    .update(schema.stockItems)
    .set({
      reserved: sql`${schema.stockItems.reserved} - ${qty}::numeric`,
      onHand: sql`${schema.stockItems.onHand} - ${qty}::numeric`,
      version: sql`${schema.stockItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.stockItems.id, stockItemId));
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "StockItem",
    aggregateId: stockItemId,
    action: "stock.consume",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { reservationId: input.reservationId, qty },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "StockReservationConsumed",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: { reservationId: input.reservationId, stockItemId, qty },
    }),
  );
  return { stockItemId, qty };
}

export interface AdjustOnHandInput {
  tenantId: string;
  stockItemId: string;
  /** Signed decimal string. */
  delta: string;
  reason: string;
  /** YYYY-MM-DD. Part of the event contract from birth; the fiscal-period gate arrives in Task 9. */
  postingDate: string;
  actor: string | null;
  correlationId?: string;
}

/** Adjust on-hand (goods receipt, cycle count, …) — guarded so it never strands reservations. */
export async function adjustOnHand(tx: Tx, input: AdjustOnHandInput): Promise<void> {
  assertSignedQty(input.delta);
  const updated = await tx
    .update(schema.stockItems)
    .set({
      onHand: sql`${schema.stockItems.onHand} + ${input.delta}::numeric`,
      version: sql`${schema.stockItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.stockItems.id, input.stockItemId),
        sql`(${schema.stockItems.allowNegative} OR (${schema.stockItems.onHand} + ${input.delta}::numeric) >= ${schema.stockItems.reserved})`,
      ),
    )
    .returning({ id: schema.stockItems.id });
  if (updated.length === 0) {
    const exists = await tx
      .select({ id: schema.stockItems.id })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.id, input.stockItemId));
    if (exists.length === 0) throw new StockItemNotFoundError(input.stockItemId);
    throw new InsufficientStockError(input.stockItemId, input.delta);
  }
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "StockItem",
    aggregateId: input.stockItemId,
    action: "stock.adjust",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { delta: input.delta, reason: input.reason, postingDate: input.postingDate },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "StockAdjusted",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: {
        stockItemId: input.stockItemId,
        delta: input.delta,
        reason: input.reason,
        postingDate: input.postingDate,
      },
    }),
  );
}

/** ATP: available = on_hand - reserved, as a decimal string (never a float). */
export async function getAvailable(tx: Tx, stockItemId: string): Promise<string> {
  const rows = await tx
    .select({ available: sql<string>`${schema.stockItems.onHand} - ${schema.stockItems.reserved}` })
    .from(schema.stockItems)
    .where(eq(schema.stockItems.id, stockItemId));
  const row = rows[0];
  if (!row) throw new StockItemNotFoundError(stockItemId);
  return row.available;
}

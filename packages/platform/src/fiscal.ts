import { type Tx, schema } from "@erp/db";
import { asTenantId, asUserId, createEvent, newId } from "@erp/kernel";
import { and, eq, sql } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import {
  PeriodClosedError,
  PeriodNotClosedError,
  PeriodNotFoundError,
  PeriodNotOpenError,
  VersionConflictError,
} from "./errors.js";
import { appendOutbox } from "./outbox.js";

export interface CreatePeriodInput {
  tenantId: string;
  year: number;
  period: number;
  /** YYYY-MM-DD (calendar date, no timezone). */
  startsOn: string;
  /** YYYY-MM-DD, inclusive. */
  endsOn: string;
  actor: string | null;
  correlationId?: string;
}

/** Create one fiscal period. Registry/setup write → audited, NO outbox event. */
export async function createPeriod(
  tx: Tx,
  input: CreatePeriodInput,
): Promise<{ periodId: string }> {
  const periodId = newId();
  await tx.insert(schema.fiscalPeriods).values({
    id: periodId,
    tenantId: input.tenantId,
    year: input.year,
    period: input.period,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  });
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "FiscalPeriod",
    aggregateId: periodId,
    action: "fiscal.create-period",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: {
      year: input.year,
      period: input.period,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    },
  });
  return { periodId };
}

export interface PeriodTransitionInput {
  tenantId: string;
  periodId: string;
  /** Optimistic lock — the UPDATE only applies if the row is still at this version. */
  expectedVersion: number;
  actor: string | null;
  correlationId?: string;
}

/**
 * Close a period: guarded UPDATE open → closed. 0 rows → disambiguating re-select:
 * missing → PeriodNotFoundError; version moved → VersionConflictError (with the actual
 * version); already closed → PeriodClosedError.
 */
export async function closePeriod(tx: Tx, input: PeriodTransitionInput): Promise<void> {
  const updated = await tx
    .update(schema.fiscalPeriods)
    .set({
      status: "closed",
      version: sql`${schema.fiscalPeriods.version} + 1`,
      closedAt: sql`now()`,
      closedBy: input.actor,
    })
    .where(
      and(
        eq(schema.fiscalPeriods.id, input.periodId),
        eq(schema.fiscalPeriods.version, input.expectedVersion),
        eq(schema.fiscalPeriods.status, "open"),
      ),
    )
    .returning({ year: schema.fiscalPeriods.year, period: schema.fiscalPeriods.period });
  const row = updated[0];
  if (!row) {
    const rows = await tx
      .select({
        id: schema.fiscalPeriods.id,
        version: schema.fiscalPeriods.version,
        status: schema.fiscalPeriods.status,
      })
      .from(schema.fiscalPeriods)
      .where(eq(schema.fiscalPeriods.id, input.periodId));
    const current = rows[0];
    if (!current) throw new PeriodNotFoundError(input.periodId);
    if (current.version !== input.expectedVersion)
      throw new VersionConflictError(input.expectedVersion, current.version);
    throw new PeriodClosedError(input.periodId);
  }
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "FiscalPeriod",
    aggregateId: input.periodId,
    action: "fiscal.close-period",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { year: row.year, period: row.period },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "FiscalPeriodClosed",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: { periodId: input.periodId, year: row.year, period: row.period },
    }),
  );
}

/**
 * Reopen a closed period (mirrors closePeriod): guarded UPDATE closed → open, clearing
 * closedAt/closedBy. Already open → PeriodNotClosedError (NOT PeriodNotOpenError — that
 * means "no open period covers a posting date").
 */
export async function reopenPeriod(tx: Tx, input: PeriodTransitionInput): Promise<void> {
  const updated = await tx
    .update(schema.fiscalPeriods)
    .set({
      status: "open",
      version: sql`${schema.fiscalPeriods.version} + 1`,
      closedAt: null,
      closedBy: null,
    })
    .where(
      and(
        eq(schema.fiscalPeriods.id, input.periodId),
        eq(schema.fiscalPeriods.version, input.expectedVersion),
        eq(schema.fiscalPeriods.status, "closed"),
      ),
    )
    .returning({ year: schema.fiscalPeriods.year, period: schema.fiscalPeriods.period });
  const row = updated[0];
  if (!row) {
    const rows = await tx
      .select({
        id: schema.fiscalPeriods.id,
        version: schema.fiscalPeriods.version,
        status: schema.fiscalPeriods.status,
      })
      .from(schema.fiscalPeriods)
      .where(eq(schema.fiscalPeriods.id, input.periodId));
    const current = rows[0];
    if (!current) throw new PeriodNotFoundError(input.periodId);
    if (current.version !== input.expectedVersion)
      throw new VersionConflictError(input.expectedVersion, current.version);
    throw new PeriodNotClosedError(input.periodId);
  }
  await appendAudit(tx, {
    tenantId: input.tenantId,
    aggregateType: "FiscalPeriod",
    aggregateId: input.periodId,
    action: "fiscal.reopen-period",
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    payload: { year: row.year, period: row.period },
  });
  await appendOutbox(
    tx,
    createEvent({
      type: "FiscalPeriodReopened",
      eventVersion: 1,
      tenantId: asTenantId(input.tenantId),
      actor: input.actor ? asUserId(input.actor) : null,
      occurredAt: new Date(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: { periodId: input.periodId, year: row.year, period: row.period },
    }),
  );
}

/**
 * The posting gate: resolve the period covering `postingDate` (inclusive bounds) and
 * require it OPEN. Fails CLOSED — no period at all → PeriodNotOpenError; a closed
 * period → PeriodClosedError. RLS scopes the lookup; the explicit tenant filter is
 * belt-and-braces.
 */
export async function assertPeriodOpen(
  tx: Tx,
  tenantId: string,
  postingDate: string,
): Promise<void> {
  const rows = await tx
    .select({ status: schema.fiscalPeriods.status })
    .from(schema.fiscalPeriods)
    .where(
      and(
        eq(schema.fiscalPeriods.tenantId, tenantId),
        sql`${postingDate}::date BETWEEN ${schema.fiscalPeriods.startsOn} AND ${schema.fiscalPeriods.endsOn}`,
      ),
    );
  const row = rows[0];
  if (!row) throw new PeriodNotOpenError(postingDate);
  if (row.status === "closed") throw new PeriodClosedError(postingDate);
}

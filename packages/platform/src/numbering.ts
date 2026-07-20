import { type Tx, schema } from "@erp/db";
import { newId } from "@erp/kernel";
import { and, eq, sql } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import { NumberRangeNotFoundError } from "./errors.js";

export interface RangeDef {
  tenantId: string;
  rangeKey: string;
  period?: string;
  prefix?: string;
  padTo?: number;
  actor: string | null;
}
// (No `gapless` flag column: every Phase-2 range is treated gapless; a merely-unique
// series mode arrives with its first consumer. The legal distinction lives in D-025.)

export async function createRange(tx: Tx, def: RangeDef): Promise<void> {
  await tx.insert(schema.numberRanges).values({
    tenantId: def.tenantId,
    rangeKey: def.rangeKey,
    period: def.period ?? "",
    prefix: def.prefix ?? "",
    padTo: def.padTo ?? 0,
  });
  await appendAudit(tx, {
    tenantId: def.tenantId,
    aggregateType: "NumberRange",
    aggregateId: `${def.rangeKey}:${def.period ?? ""}`,
    action: "numbering.create-range",
    actor: def.actor,
    payload: { ...def, actor: undefined },
  });
}

export interface AllocateInput {
  tenantId: string;
  rangeKey: string;
  period?: string;
  docRef?: string | null;
}

/**
 * Allocate the next number under the counter row's lock. CONVENTION (spec §6): call this
 * as LATE as possible in the business transaction — the lock is held until commit, and a
 * later rollback is what turns an allocation into a gap.
 *
 * Lock-ordering rule: if the allocated number must appear in an audit payload, every flow
 * touching that SAME shared audit aggregate must allocate before its first appendAudit
 * (or none must) — mixing the two orders on a shared aggregate is an ABBA deadlock.
 */
export async function allocateNumber(
  tx: Tx,
  input: AllocateInput,
): Promise<{ value: number; formatted: string }> {
  const period = input.period ?? "";
  const rows = await tx
    .update(schema.numberRanges)
    .set({ currentValue: sql`${schema.numberRanges.currentValue} + 1` })
    .where(
      and(
        eq(schema.numberRanges.tenantId, input.tenantId),
        eq(schema.numberRanges.rangeKey, input.rangeKey),
        eq(schema.numberRanges.period, period),
      ),
    )
    .returning({
      value: schema.numberRanges.currentValue,
      prefix: schema.numberRanges.prefix,
      padTo: schema.numberRanges.padTo,
    });
  const row = rows[0];
  if (!row) throw new NumberRangeNotFoundError(input.rangeKey, period);
  await tx.insert(schema.numberAllocations).values({
    id: newId(),
    tenantId: input.tenantId,
    rangeKey: input.rangeKey,
    period,
    value: row.value,
    docRef: input.docRef ?? null,
  });
  const digits = String(row.value);
  return {
    value: row.value,
    formatted: `${row.prefix}${row.padTo > 0 ? digits.padStart(row.padTo, "0") : digits}`,
  };
}

/** Holes between 1 and current_value with no journal row — every one must be explainable.
 * O(current_value) scan — fine as an on-demand diagnostic; add a {fromValue,toValue}
 * window before wiring a recurring production consumer (e.g. period-close checks). */
export async function detectGaps(
  tx: Tx,
  ref: { tenantId: string; rangeKey: string; period?: string },
): Promise<number[]> {
  const period = ref.period ?? "";
  const res = await tx.execute(sql`
    SELECT gs.v FROM md.number_ranges r
    CROSS JOIN LATERAL generate_series(1, r.current_value) AS gs(v)
    LEFT JOIN md.number_allocations a
      ON a.tenant_id = r.tenant_id AND a.range_key = r.range_key AND a.period = r.period AND a.value = gs.v
    WHERE r.tenant_id = ${ref.tenantId} AND r.range_key = ${ref.rangeKey} AND r.period = ${period} AND a.id IS NULL
    ORDER BY gs.v
  `);
  return (res.rows as Array<{ v: number | string }>).map((r) => Number(r.v));
}

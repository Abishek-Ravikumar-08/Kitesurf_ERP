import { createHash } from "node:crypto";
import { type Db, type Tx, schema } from "@erp/db";
import { newId } from "@erp/kernel";
import { and, asc, eq, sql } from "drizzle-orm";
import { stableStringify } from "./stable-stringify.js";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface AuditEntry {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  actor?: string | null;
  correlationId?: string | null;
  /** Hashed (stableStringify → sha256), NEVER stored — the log is PII-free by construction. */
  payload: unknown;
}

/** Append one link to the aggregate's hash chain. MUST run inside the same tx as the business write. */
export async function appendAudit(tx: Tx, e: AuditEntry): Promise<{ seq: number; hash: string }> {
  // Upsert-with-self-assignment takes the head's row lock (serializes the chain per
  // aggregate, race-safe including first-ever append) and returns the current head.
  const head = await tx.execute(sql`
    INSERT INTO platform.audit_head AS h (tenant_id, aggregate_type, aggregate_id, last_seq, last_hash)
    VALUES (${e.tenantId}, ${e.aggregateType}, ${e.aggregateId}, 0, '')
    ON CONFLICT (tenant_id, aggregate_type, aggregate_id)
    DO UPDATE SET last_seq = h.last_seq
    RETURNING h.last_seq AS last_seq, h.last_hash AS last_hash
  `);
  const row = head.rows[0] as { last_seq: number; last_hash: string };
  const seq = row.last_seq + 1;
  const prevHash = row.last_hash;
  const payloadHash = sha256(stableStringify(e.payload));
  const hash = sha256(
    JSON.stringify([
      prevHash,
      e.tenantId,
      e.aggregateType,
      e.aggregateId,
      seq,
      e.action,
      e.actor ?? null,
      e.correlationId ?? null,
      payloadHash,
    ]),
  );
  await tx.insert(schema.auditLog).values({
    id: newId(),
    tenantId: e.tenantId,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    seq,
    action: e.action,
    actor: e.actor ?? null,
    correlationId: e.correlationId ?? null,
    payloadHash,
    prevHash,
    hash,
  });
  await tx
    .update(schema.auditHead)
    .set({ lastSeq: seq, lastHash: hash })
    .where(
      and(
        eq(schema.auditHead.tenantId, e.tenantId),
        eq(schema.auditHead.aggregateType, e.aggregateType),
        eq(schema.auditHead.aggregateId, e.aggregateId),
      ),
    );
  return { seq, hash };
}

export interface ChainRef {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}
export type ChainVerdict =
  | { valid: true; length: number }
  | { valid: false; brokenAtSeq: number; reason: string };

/** Recompute the whole chain from the log and cross-check the head. Runs on any handle (worker cron uses the owner connection). */
export async function verifyAuditChain(db: Db, ref: ChainRef): Promise<ChainVerdict> {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.tenantId, ref.tenantId),
        eq(schema.auditLog.aggregateType, ref.aggregateType),
        eq(schema.auditLog.aggregateId, ref.aggregateId),
      ),
    )
    .orderBy(asc(schema.auditLog.seq));
  let prev = "";
  for (const [i, r] of rows.entries()) {
    if (r.seq !== i + 1) return { valid: false, brokenAtSeq: r.seq, reason: "sequence gap" };
    if (r.prevHash !== prev)
      return { valid: false, brokenAtSeq: r.seq, reason: "prev-hash mismatch" };
    const expect = sha256(
      JSON.stringify([
        r.prevHash,
        r.tenantId,
        r.aggregateType,
        r.aggregateId,
        r.seq,
        r.action,
        r.actor,
        r.correlationId,
        r.payloadHash,
      ]),
    );
    if (r.hash !== expect) return { valid: false, brokenAtSeq: r.seq, reason: "hash mismatch" };
    prev = r.hash;
  }
  const [head] = await db
    .select()
    .from(schema.auditHead)
    .where(
      and(
        eq(schema.auditHead.tenantId, ref.tenantId),
        eq(schema.auditHead.aggregateType, ref.aggregateType),
        eq(schema.auditHead.aggregateId, ref.aggregateId),
      ),
    );
  // A wiped/truncated log must not verify clean: the head's seq is the expected length.
  const headSeq = head?.lastSeq ?? 0;
  if (headSeq !== rows.length) {
    return {
      valid: false,
      brokenAtSeq: rows.length,
      reason: `head seq ${headSeq} != log length ${rows.length}`,
    };
  }
  if (rows.length > 0 && head?.lastHash !== prev) {
    return { valid: false, brokenAtSeq: rows.length, reason: "head mismatch" };
  }
  return { valid: true, length: rows.length };
}

import { randomUUID } from "node:crypto";
import { schema, withTenantTx } from "@erp/db";
import { sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit, verifyAuditChain } from "./audit.js";
import { type TestDb, expectPgError, inParallel, startTestDb } from "./testkit.js";

describe("hash-chained immutable audit", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });

  it("appends a verifiable chain", async () => {
    for (let i = 1; i <= 3; i++) {
      await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        appendAudit(tx, {
          tenantId: t.tenantId,
          aggregateType: "StockItem",
          aggregateId: "it-1",
          action: `op-${i}`,
          payload: { i },
        }),
      );
    }
    const verdict = await verifyAuditChain(t.handle.db, {
      tenantId: t.tenantId,
      aggregateType: "StockItem",
      aggregateId: "it-1",
    });
    expect(verdict).toEqual({ valid: true, length: 3 });
  });

  it("audit rows are immutable (UPDATE/DELETE/TRUNCATE all blocked, even for superuser)", async () => {
    await expectPgError(
      t.handle.db.execute(sql`UPDATE platform.audit_log SET action = 'tampered'`),
      /append-only/,
    );
    await expectPgError(t.handle.db.execute(sql`DELETE FROM platform.audit_log`), /append-only/);
    await expectPgError(t.handle.db.execute(sql`TRUNCATE platform.audit_log`), /append-only/);
  });

  it("a tampered chain is detected", async () => {
    await t.handle.db.execute(
      sql`ALTER TABLE platform.audit_log DISABLE TRIGGER audit_log_no_update_delete`,
    );
    try {
      await t.handle.db.execute(sql`
        UPDATE platform.audit_log SET payload_hash = 'forged'
        WHERE tenant_id = ${t.tenantId} AND aggregate_type = 'StockItem' AND aggregate_id = 'it-1' AND seq = 2
      `);
    } finally {
      await t.handle.db.execute(
        sql`ALTER TABLE platform.audit_log ENABLE TRIGGER audit_log_no_update_delete`,
      );
    }
    const verdict = await verifyAuditChain(t.handle.db, {
      tenantId: t.tenantId,
      aggregateType: "StockItem",
      aggregateId: "it-1",
    });
    expect(verdict.valid).toBe(false);
  });

  it("a WIPED chain is detected (head seq vs log length)", async () => {
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      appendAudit(tx, {
        tenantId: t.tenantId,
        aggregateType: "WipeAgg",
        aggregateId: "w-1",
        action: "created",
        payload: { ok: true },
      }),
    );
    await t.handle.db.execute(
      sql`ALTER TABLE platform.audit_log DISABLE TRIGGER audit_log_no_update_delete`,
    );
    try {
      await t.handle.db.execute(sql`
        DELETE FROM platform.audit_log
        WHERE tenant_id = ${t.tenantId} AND aggregate_type = 'WipeAgg' AND aggregate_id = 'w-1'
      `);
    } finally {
      await t.handle.db.execute(
        sql`ALTER TABLE platform.audit_log ENABLE TRIGGER audit_log_no_update_delete`,
      );
    }
    const verdict = await verifyAuditChain(t.handle.db, {
      tenantId: t.tenantId,
      aggregateType: "WipeAgg",
      aggregateId: "w-1",
    });
    expect(verdict.valid).toBe(false);
  });

  it("property: concurrent appends across aggregates keep every chain dense and valid", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 4, maxLength: 12 }),
        async (picks) => {
          const run = randomUUID();
          await inParallel(
            picks.map(
              (pick, i) => () =>
                withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
                  appendAudit(tx, {
                    tenantId: t.tenantId,
                    aggregateType: "PropAgg",
                    aggregateId: `${run}-${pick}`,
                    action: `op-${i}`,
                    payload: { i, pick },
                  }),
                ),
            ),
          );
          for (const pick of new Set(picks)) {
            const verdict = await verifyAuditChain(t.handle.db, {
              tenantId: t.tenantId,
              aggregateType: "PropAgg",
              aggregateId: `${run}-${pick}`,
            });
            expect(verdict).toEqual({
              valid: true,
              length: picks.filter((p) => p === pick).length,
            });
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it("normalizes uuid case: an UPPERCASE tenantId appends a chain that verifies valid", async () => {
    const upper = t.tenantId.toUpperCase();
    await withTenantTx(t.handle.db, { tenantId: upper }, (tx) =>
      appendAudit(tx, {
        tenantId: upper,
        aggregateType: "CaseAgg",
        aggregateId: "c-1",
        action: "created",
        payload: { ok: true },
      }),
    );
    const verdict = await verifyAuditChain(t.handle.db, {
      tenantId: t.tenantId,
      aggregateType: "CaseAgg",
      aggregateId: "c-1",
    });
    expect(verdict).toEqual({ valid: true, length: 1 });
  });

  it("RLS: a second tenant reads ZERO audit rows of the first", async () => {
    const tenantB = randomUUID();
    await t.handle.db.insert(schema.tenants).values({ id: tenantB, name: "tenant-b" });
    const rows = await withTenantTx(t.handle.db, { tenantId: tenantB }, (tx) =>
      tx.select().from(schema.auditLog),
    );
    expect(rows).toHaveLength(0);
  });

  it("RLS: a context-less app_rw session reads ZERO audit rows", async () => {
    const rows = await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return tx.select().from(schema.auditLog);
    });
    expect(rows).toHaveLength(0);
  });
});

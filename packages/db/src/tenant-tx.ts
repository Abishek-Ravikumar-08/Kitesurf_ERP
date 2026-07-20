import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

export interface TenantContext {
  tenantId: string;
  userId?: string | null;
}

/** The drizzle transaction handle every @erp/platform function takes. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * THE mandatory write path: opens a transaction, sets the RLS context via SET LOCAL
 * (transaction-scoped — safe under pooling), and drops to the non-owner app_rw role so
 * RLS is enforced even on owner/superuser pool connections. Everything inside runs
 * tenant-scoped and fail-closed.
 */
export async function withTenantTx<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE app_rw`);
    return fn(tx);
  });
}

import { sql } from "drizzle-orm";
import { pgPolicy, pgRole } from "drizzle-orm/pg-core";

/** Runtime role every withTenantTx drops to. NOLOGIN; RLS applies to it (it is not the owner). */
export const appRw = pgRole("app_rw");

/** Fail-closed tenant predicate: unset/empty app.tenant_id → NULL → no rows / write rejected. */
export const tenantCtx = sql`NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

/** Standard tenant-isolation policy for any table with a tenant_id column. TO public: uniform enforcement (superuser bypasses; app_rw is enforced). */
export function tenantIsolation(policyName: string) {
  return pgPolicy(policyName, {
    as: "permissive",
    for: "all",
    using: sql`tenant_id = ${tenantCtx}`,
    withCheck: sql`tenant_id = ${tenantCtx}`,
  });
}

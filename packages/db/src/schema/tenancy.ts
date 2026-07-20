import { sql } from "drizzle-orm";
import { pgPolicy, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Inlined copy of tenantCtx from ./rls.js — drizzle-kit's esbuild/CJS loader cannot resolve
// relative ".js" imports between schema files (D-017), so schema files stay import-free
// of each other. Keep in sync with rls.ts (same SQL, fail-closed).
const tenantCtx = sql`NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

export const platformSchema = pgSchema("platform");

// The tenant registry. Its own RLS scopes by id (a session sees only its own tenant row);
// creating tenants is a bootstrap/privileged operation (superuser path).
export const tenants = platformSchema.table(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy("tenants_self_isolation", {
      as: "permissive",
      for: "all",
      using: sql`id = ${tenantCtx}`,
      withCheck: sql`id = ${tenantCtx}`,
    }),
  ],
);

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export function makeDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  // node-postgres REQUIRES a pool-level error listener: idle pooled clients emit
  // 'error' when their backend dies (Postgres restart/shutdown → FATAL 57P01), the
  // pool re-emits it, and with no listener the event throws as an uncaught exception —
  // crashing the api/worker on an appliance Postgres restart (and failing CI runs at
  // Testcontainers teardown). Log it; the pool discards the dead client and self-heals
  // on the next checkout, while /ready and the worker boot gate report unavailability.
  pool.on("error", (err) => {
    console.error(
      `[db] idle pool client error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  return { pool, db: drizzle(pool, { schema }) };
}
export type Db = ReturnType<typeof makeDb>["db"];

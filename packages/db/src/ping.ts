import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/** Cheap connectivity probe; throws if the database is unreachable. */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

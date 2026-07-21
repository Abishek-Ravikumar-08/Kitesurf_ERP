import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";
import { platformMeta } from "./schema/platform.js";

/** The version this code build expects the DB to be at. Bump when a migration ships. */
export const EXPECTED_SCHEMA_VERSION = 7;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function runMigrations(db: Db): Promise<void> {
  // NOTE: migrate() and the meta-row upsert are separate statements and are NOT serialized
  // against concurrent callers (drizzle's migrator takes no advisory lock). Fine for
  // single-instance boot; before blue/green rolling updates land, wrap this in
  // pg_advisory_lock to stop two instances racing on the same migration.
  await migrate(db, { migrationsFolder });
  // upsert the single meta row to the expected version
  await db
    .insert(platformMeta)
    .values({ id: 1, schemaVersion: EXPECTED_SCHEMA_VERSION })
    .onConflictDoUpdate({
      target: platformMeta.id,
      set: { schemaVersion: EXPECTED_SCHEMA_VERSION },
    });
}

/** Boot gate: refuse to start if the DB schema version != the code's expected version. */
export async function assertSchemaVersion(db: Db): Promise<void> {
  const rows = await db.select().from(platformMeta).limit(1);
  const dbVersion = rows[0]?.schemaVersion ?? null;
  if (dbVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(
      `schema version mismatch: db=${dbVersion} expected=${EXPECTED_SCHEMA_VERSION}. Run migrations before starting.`,
    );
  }
}

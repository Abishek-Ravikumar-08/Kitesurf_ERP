import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./client.js";
import { EXPECTED_SCHEMA_VERSION, assertSchemaVersion, runMigrations } from "./migrate.js";

describe("migrations + schema-version gate", () => {
  let container: StartedPostgreSqlContainer;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    const made = makeDb(container.getConnectionUri());
    db = made.db;
    close = async () => {
      await made.pool.end();
      await container.stop();
    };
  });
  afterAll(async () => {
    await close();
  });

  it("applies migrations and records the expected schema version", async () => {
    await runMigrations(db);
    await expect(assertSchemaVersion(db)).resolves.toBeUndefined();
  });

  it("boot gate throws on a version mismatch", async () => {
    await runMigrations(db); // ensure schema exists + version reset to expected, so this test is independent of test order
    // Force a mismatch, then assert the gate refuses.
    await db.execute(
      sql`UPDATE platform_meta SET schema_version = ${EXPECTED_SCHEMA_VERSION + 99} WHERE id = 1`,
    );
    await expect(assertSchemaVersion(db)).rejects.toThrow(/schema version mismatch/);
  });
});

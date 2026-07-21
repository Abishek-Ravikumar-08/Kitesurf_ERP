import { EXPECTED_SCHEMA_VERSION, makeDb, runMigrations } from "@erp/db";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("GET /ready (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
    await runMigrations(handle.db);
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  async function bootApp(databaseUrl: string): Promise<INestApplication> {
    process.env.DATABASE_URL = databaseUrl;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    return app;
  }

  it("returns 200 ready on a migrated database", async () => {
    const app = await bootApp(container.getConnectionUri());
    const res = await request(app.getHttpServer()).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
    await app.close();
  });

  it("returns 503 on a schema-version mismatch", async () => {
    // NOTE: deliberately uses the raw pg pool, not drizzle's `sql` — drizzle-orm is not
    // (and must not become) a dependency of the api; @erp/db owns all drizzle usage.
    await handle.pool.query("UPDATE platform_meta SET schema_version = $1 WHERE id = 1", [
      EXPECTED_SCHEMA_VERSION + 99,
    ]);
    const app = await bootApp(container.getConnectionUri());
    const res = await request(app.getHttpServer()).get("/ready");
    expect(res.status).toBe(503);
    await app.close();
    await runMigrations(handle.db); // restore for other tests
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = await bootApp("postgresql://erp:erp@localhost:59999/nope");
    const res = await request(app.getHttpServer()).get("/ready");
    expect(res.status).toBe(503);
    await app.close();
  });
});

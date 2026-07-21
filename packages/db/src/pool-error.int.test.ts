import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDb } from "./client.js";

/**
 * Pins the node-postgres requirement that a Pool has an 'error' listener: idle pooled
 * clients emit 'error' when their backend dies (Postgres restart/shutdown → FATAL 57P01),
 * the pool re-emits it, and with no pool listener the event THROWS as an uncaught
 * exception — crashing the api/worker in production and failing CI runs at Testcontainers
 * teardown even when every test passed. pg_terminate_backend() on an idle pooled client
 * exercises the identical path deterministically (no shutdown timing race).
 */
describe("makeDb pool error handling", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  it("survives an idle pooled client being terminated server-side and self-heals", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Hold TWO clients so the pool cannot reuse A for the terminate call.
      const clientA = await handle.pool.connect();
      const clientB = await handle.pool.connect();
      const pidA = (await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
        ?.pid;
      expect(pidA).toBeTypeOf("number");
      clientA.release(); // A is now IDLE in the pool — the crash-prone state.

      await clientB.query("SELECT pg_terminate_backend($1)", [pidA]);
      clientB.release();

      // Condition-based wait: the FATAL propagates to idle client A, the pool discards
      // it and (with the fix) routes the error to the makeDb handler instead of throwing.
      const deadline = Date.now() + 5_000;
      while (errorLog.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(handle.pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
      expect(errorLog).toHaveBeenCalled();
      // Self-heal: the pool serves fresh connections after discarding the dead client.
      const after = await handle.pool.query("SELECT 1 AS ok");
      expect(after.rows[0]).toEqual({ ok: 1 });
    } finally {
      errorLog.mockRestore();
    }
  });
});

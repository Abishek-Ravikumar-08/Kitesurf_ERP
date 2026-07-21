import { randomUUID } from "node:crypto";
import { makeDb, runMigrations, schema } from "@erp/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestDb {
  container: StartedPostgreSqlContainer;
  handle: ReturnType<typeof makeDb>;
  tenantId: string;
  stop: () => Promise<void>;
}

/** One container per suite; a bootstrapped tenant; migrations applied. */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
  const handle = makeDb(container.getConnectionUri());
  await runMigrations(handle.db);
  const tenantId = randomUUID();
  await handle.db.insert(schema.tenants).values({ id: tenantId, name: "test-tenant" });
  return {
    container,
    handle,
    tenantId,
    stop: async () => {
      await handle.pool.end();
      await container.stop();
    },
  };
}

/** Await a rejection and match the ROOT cause message (drizzle >= 0.44 wraps driver errors in DrizzleQueryError). */
export async function expectPgError(p: Promise<unknown>, re: RegExp): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (!err) throw new Error(`expected a rejection matching ${re}, got success`);
  const msg = String((err as { cause?: Error }).cause?.message ?? (err as Error).message);
  if (!re.test(msg)) throw new Error(`expected ${re}, got: ${msg}`);
}

/** Run `n` thunks with real parallelism and collect settled results. */
export async function inParallel<T>(
  thunks: Array<() => Promise<T>>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(thunks.map((t) => t()));
}

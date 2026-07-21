# Phase 2 — Correctness Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every write in the system tenant-scoped (RLS fail-closed), audited (hash-chained, same transaction), and evented (transactional outbox, same transaction) — then land the four spec-§6 correctness domains (inventory reservation/ATP, optimistic locking, gapless number ranges, fiscal calendar/period gate) on that plumbing, each property-tested under real concurrency.

**Architecture:** `@erp/db` stays infrastructure (client, all pgTable schema, migrations, the new RLS transaction wrapper `withTenantTx`). A new **`@erp/platform`** package holds the transactional domain logic (audit append, outbox append, reserve/release/consume/adjust, number allocation, fiscal gate) as functions taking a `tx` handle so callers compose them into one atomic transaction — its barrel is the proto-port surface future modules import. A new minimal **`apps/worker`** (spec §2.1 worker tier) hosts pg-boss, the outbox relay, and an audit chain-verify cron. `apps/api` changes only by the all-ESM flip and `GET /ready`. No other HTTP surface: the correctness core ships as library + DB, exercised by Testcontainers integration tests.

**Tech Stack:** everything Phase 1 pinned, plus **pg-boss 12** (jobs/cron) and **fast-check 4** (property tests). PostgreSQL RLS with `FORCE ROW LEVEL SECURITY`; Drizzle `pgSchema`/`pgPolicy`/`pgRole` (Context7-verified for 0.45.2); Node 24; all packages **ESM**.

- **Implements:** spec §6 (correctness core), §7 (tenancy/RLS + audit tranche), §8 (envelope/versioning/idempotency), §9.1–9.2 (data/eventing), §10.2 (sub-sequencing) — [2026-07-16-erp-ai-native-system-design.md](../docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md)
- **Status:** ✅ complete (pending PR — user opens it; CI runs on the `pull_request` trigger)
- **Created:** 2026-07-18 · **Last updated:** 2026-07-20
- **Depends on:** Phase 1 (merged to `main` @ `ddd37f8`, PR #1)

---

## Scope

- **In:** all-ESM flip for `apps/api` (+ documented require(esm) fallback); `GET /ready` (first `@erp/db` import from the api); CI actions bump; tenancy + fail-closed RLS (`FORCE`, `withTenantTx`, `app_rw` role); hash-chained immutable audit; transactional outbox + `event_archive` + pg-boss relay in a new `apps/worker`; `md.materials` stub; reservation/ATP; optimistic locking; gapless number ranges; fiscal calendar + period gate; minimal deterministic seeds; concurrency property tests (fast-check) for every correctness domain.
- **Out (deferred):** Keycloak/OIDC BFF/CASL/`ai_ro` wiring, the saga engine, approval engine, MDM beyond the materials stub, Day-0 provisioning, files/AV, notifications, printing, import/export, search, public API, licensing, GDPR → **Phase 3+** (deliberate deviation from a literal §10.2 reading — record as a decision). The shared **§8 idempotency-key table** also → Phase 3, alongside the first pg-boss consumer handlers that would key into it — Phase 2's idempotency = `relayed_at` claim + archive `ON CONFLICT` + optimistic version guards (there are no consumer handlers yet). Stryker mutation testing (spec §9.10) → later hardening. SAP number-range modes → Phase 5 (the allocator interface leaves the seam). `@erp/kernel` is untouched (Money/UoM already satisfy §6's kernel half).

## Decisions already made (brainstorm 2026-07-18, user-approved)

1. **Scope:** spine + full §6 in one phase; auth + saga defer to Phase 3. One plan, one branch, one PR.
2. **Module format:** **all-ESM** — flip `apps/api` to `"type": "module"`; hard verification gate in Task 1; fallback = keep api CJS and use Node 24 `require(esm)` (needs TS ≥ 5.8).
3. **Property harness:** **fast-check** + a pool-of-N-connections parallel runner in the `test:int` lane; Stryker deferred.
4. Postgres schemas named by **eventual owner** (`platform`, `md`, `wh`, `fin`) to avoid table moves later.
5. RLS model: policies `TO public`, **`ENABLE` + `FORCE ROW LEVEL SECURITY`** on every tenant table; the app path always runs `SET LOCAL ROLE app_rw` inside `withTenantTx`; superuser (migrations/seeds/bootstrap/relay) deliberately bypasses. Fail-closed = unset/empty `app.tenant_id` → reads return 0 rows, writes rejected by `WITH CHECK`.
6. Audit chains serialize per aggregate via a **row-locked `audit_head`** upsert; the log stores **payload hashes only** (PII-free by construction).
7. Outbox relay is **at-least-once**: `singletonKey` gives best-effort dedupe while queued; **consumer idempotency** (spec §8) is the real guarantee. Relay runs on the worker's owner connection (cross-tenant infrastructure; never mutates domain tables).
8. Gapless ranges: row-locked `UPDATE … RETURNING` + in-tx allocations journal; crash-rollback gaps are **detected (`detectGaps`) and explained, not prevented** — the legally-gapless vs merely-unique distinction the spec requires documented.

## Conventions for every task

- **TDD:** write the failing test → run it (see it fail) → minimal implementation → run it (pass) → commit. One logical change per commit; conventional-commit messages.
- **Context7 before library code:** the APIs below were verified **2026-07-18** (Drizzle `pgSchema`/`pgPolicy`/`pgRole`/`entities.roles`, pg-boss 12 `start/createQueue/send/work/schedule` + insert-id caveat, fast-check `asyncProperty`/`numRuns`/seed-replay, NestJS SWC builder + partial-ESM caveat). **Re-verify at execution** and after any bump; pin in the pnpm catalog.
- **Branch:** work on `phase-02-correctness-core` off `main` (**never commit to `main`**); push; the **user opens the PR via the browser** (no gh CLI / github MCP in this environment). Compare URL: `https://github.com/Abishek-Ravikumar-08/Kitesurf_ERP/compare/main...phase-02-correctness-core?expand=1`
- **Migrations:** every migration task bumps `EXPECTED_SCHEMA_VERSION` in `packages/db/src/migrate.ts` and asserts it in the task's test. Generated SQL is **reviewed and checked in**. Custom SQL (roles' grants, FORCE RLS, triggers, extensions) goes in hand-written custom migrations (`drizzle-kit generate --custom --name=<x>`).
- **Build before dependent tests:** workspace packages resolve via `dist` (`main`/`types` point at build output; no src fallback). After modifying `@erp/db`, `@erp/contracts`, or `@erp/platform`, run **`pnpm -r build`** (topological) before running any OTHER package's tests that import them — otherwise tests fail on module-not-found or run against a stale dist. CI builds immediately after install for the same reason (Task 1). On **RED steps** (test written, implementation missing), the full `pnpm -r build` fails at the unimplemented package's `tsc` — that compile/module-resolution error IS the expected red; to see the test itself fail instead, build only upstream (e.g. `pnpm --filter @erp/db build`).
- **Every domain-fact mutation** in `@erp/platform` (reserve/release/consume/adjust, period close/reopen) writes counter/row + ledger + **audit** + **outbox** in ONE transaction, takes `tenantId` explicitly, and runs under `withTenantTx` (RLS enforced). Scoped exceptions, so nobody has to guess: registry/setup writes (`createRange`, `createPeriod`) audit but emit **no event** (no consumer-facing fact); `allocateNumber` writes the allocations **journal** as its audit record — the ENCLOSING business transaction audits the document that consumed the number. Decimals travel as **strings**; `qty`/money columns are `NUMERIC`.
- **Every new tenant table's int test includes two RLS probes:** context-less read → 0 rows; cross-tenant read → 0 rows.

---

## File structure (created/modified this phase)

```
pnpm-workspace.yaml                     # + pg-boss, fast-check catalog pins
.github/workflows/ci.yml                # actions bump (checkout@v5, setup-node@v5)
.env.example                            # + RELAY_INTERVAL_MS

packages/db/
  drizzle.config.ts                     # + new schema files (explicit list, D-017), entities.roles
  src/schema/rls.ts                     # app_rw pgRole + tenantIsolation policy helper   [NEW]
  src/schema/tenancy.ts                 # platform.tenants                                [NEW]
  src/schema/audit.ts                   # platform.audit_head + platform.audit_log        [NEW]
  src/schema/outbox.ts                  # platform.outbox + platform.event_archive        [NEW]
  src/schema/masterdata.ts              # md.materials (stub)                             [NEW]
  src/schema/stock.ts                   # wh.stock_items + wh.stock_reservations          [NEW]
  src/schema/numbering.ts               # md.number_ranges + md.number_allocations        [NEW]
  src/schema/fiscal.ts                  # fin.fiscal_periods                              [NEW]
  src/tenant-tx.ts                      # withTenantTx (SET LOCAL role + GUCs) + Tx type  [NEW]
  src/ping.ts                           # ping(db) → SELECT 1                             [NEW]
  src/seed.ts                           # seedBaseline(db) deterministic dev/demo seed    [NEW]
  src/rls.int.test.ts                   # fail-closed proof                               [NEW]
  src/seed.int.test.ts                  # seed idempotency                                [NEW]
  drizzle/                              # 000N generated + custom migrations (checked in)

packages/platform/                      # @erp/platform — transactional domain logic     [NEW]
  package.json tsconfig.json vitest.config.ts vitest.int.config.ts
  src/index.ts                          # barrel = proto-port surface
  src/errors.ts                         # typed domain errors
  src/stable-stringify.ts (+ .test.ts)  # deterministic JSON for hashing
  src/audit.ts (+ audit.int.test.ts)    # appendAudit / verifyAuditChain
  src/outbox.ts                         # appendOutbox
  src/outbox-relay.ts (+ .int.test.ts)  # relayOutboxBatch + ConsumerRegistry
  src/stock.ts (+ stock.int.test.ts)    # reserve/release/consume/adjust/getAvailable
  src/numbering.ts (+ .int.test.ts)     # createRange/allocateNumber/detectGaps
  src/fiscal.ts (+ fiscal.int.test.ts)  # createPeriod/closePeriod/reopenPeriod/assertPeriodOpen
  src/testkit.ts                        # shared int-test helpers (container, ctx, parallel)

packages/contracts/
  src/events/stock.ts                   # StockReservedV1 … Zod payload schemas           [NEW]
  src/events/fiscal.ts                  # FiscalPeriodClosedV1/ReopenedV1                 [NEW]
  src/events/registry.ts               # EVENT_SCHEMAS {type: {version: schema}}          [NEW]
  src/index.ts                          # + barrel exports

apps/api/
  package.json                          # + "type": "module", @erp/db dep, test:int
  .swcrc                                # + "module": { "type": "es6" }
  vitest.int.config.ts                  # int lane (Testcontainers)                       [NEW]
  src/db/db.module.ts                   # DB provider + pool shutdown                     [NEW]
  src/health/ready.controller.ts        # GET /ready → 200 | 503                          [NEW]
  src/health/ready.int.test.ts          # Testcontainers                                  [NEW]

apps/worker/                            # @erp/worker — NestJS app context (no HTTP)     [NEW]
  package.json tsconfig.json nest-cli.json .swcrc vitest.config.ts vitest.int.config.ts
  src/main.ts                           # boot: config → schema gate → boss → relay loop
  src/worker.module.ts
  src/config/env.ts (+ env.test.ts)     # DATABASE_URL, RELAY_INTERVAL_MS
  src/relay/relay.service.ts            # interval loop + reentrancy guard + shutdown
  src/registry.ts                       # prod ConsumerRegistry (empty in Phase 2)
  src/worker.int.test.ts                # boots against migrated container; gate fails closed
```

---

## Task 0: Branch + plan status

- [x] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b phase-02-correctness-core
```

- [x] **Step 2: Mark this plan in-progress** — edit this file's `**Status:**` line to `🚧 in progress`.

- [x] **Step 3: Commit**

```bash
git add plans/phase-02-correctness-core.md
git commit -m "docs(plans): phase-02 correctness core - mark in progress"
```

---

## Task 1: All-ESM flip for `apps/api` + CI actions bump

**Files:** Modify `apps/api/package.json`, `apps/api/.swcrc`, `.github/workflows/ci.yml`.

The api currently runs CommonJS (D-018); all `@erp/*` packages are ESM (D-014). Phase-1 api code already uses `.js` relative specifiers, so this is a config flip. **This task is a hard gate:** NestJS's own docs flag ESM support as partial (an `esmCompatible` tooling flag exists; the framework is CJS-first), so verify honestly and fall back cleanly if the framework fights back.

- [x] **Step 1: Run the full api suite green as the baseline**

Run as discrete steps (do NOT chain with `&` — backgrounding the whole chain makes the curl race the build):
1. `pnpm --filter @erp/api test` → PASS
2. `pnpm --filter @erp/api build` → emits `apps/api/dist/main.js`
3. In a second terminal: `DATABASE_URL=postgresql://erp:erp@localhost:5432/erp node apps/api/dist/main.js` (PowerShell: set `$env:DATABASE_URL` first). The env var matters: `loadConfig` fails fast without `DATABASE_URL` — do not misread that config error as an ESM failure.
4. `curl -s localhost:3000/health` → `{"status":"ok"}`; stop the node process.

- [x] **Step 2: Flip to ESM**

`apps/api/package.json`: add `"type": "module"` (top level, next to `"private": true`).
`apps/api/.swcrc`: add a `module` block so SWC emits ESM for **both** `nest build` and Vitest (unplugin-swc reads this same file — that was D-018's point):

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2023"
  },
  "module": { "type": "es6" }
}
```

- [x] **Step 3: Run the gate — tests, build, boot** *(gate PASSED first try — ESM shipped, fallback unused → D-020)*

Run: `pnpm --filter @erp/api typecheck && pnpm --filter @erp/api test && pnpm --filter @erp/api build`
Then boot: `DATABASE_URL=postgresql://erp:erp@localhost:5432/erp node apps/api/dist/main.js` and `curl -s localhost:3000/health` → `{"status":"ok"}`; stop it.
Expected: ALL green. Diagnose config-level failures (bad `.swcrc`, missing `.js` specifier) normally — those are ours. If the **framework** fails under ESM (e.g. Nest internals throwing `ERR_REQUIRE_ESM`/resolution errors after ~1h of diagnosis), execute the fallback:

> **Fallback (only if the gate stays red): keep api CJS + Node 24 `require(esm)`.**
> 1. Revert Step 2 (`git checkout -- apps/api/package.json apps/api/.swcrc`).
> 2. Confirm the installed TypeScript is ≥ 5.8 (`pnpm why typescript`); if not, bump the catalog pin to `^5.8.0` and reinstall — TS ≥ 5.8 under `NodeNext` type-checks `import` of ESM-only packages from CJS, and Node 24 executes the emitted `require()` of ESM natively (no top-level await exists in `@erp/*`, which is the one constraint).
> 3. Re-run this step's gate commands; Task 2 then proceeds with the api staying CJS.
> Record whichever variant shipped as **D-020**.

- [x] **Step 4: Commit the flip**

```bash
git add apps/api/package.json apps/api/.swcrc
git commit -m "refactor(api): run apps/api as ESM (type module, swc es6 emit)"
```

- [x] **Step 5: CI actions bump** *(pnpm/action-setup bumped to v6 — tag verified to exist)* (clears the Node-20-deprecation warnings on the runners)

In `.github/workflows/ci.yml`, bump the action versions AND move `pnpm build` to run right after install — from Phase 2 on, cross-package imports resolve via each package's `dist`, so typecheck/tests need the workspace built first:

```yaml
      - uses: actions/checkout@v5          # TODO: pin to commit SHA before first release
      - uses: pnpm/action-setup@v4         # reads packageManager; check for a newer major at execution
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build                    # FIRST: workspace deps resolve via dist
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm boundaries
      - run: pnpm test
      - run: pnpm -r test:int
```
(The trailing `pnpm build` step is removed — it moved up.)

- [x] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: bump actions to v5; build workspace before typecheck and tests"
```

---

## Task 2: `GET /ready` — the api's first `@erp/db` import

**Files:** Create `apps/api/src/db/db.module.ts`, `apps/api/src/health/ready.controller.ts`, `apps/api/src/health/ready.int.test.ts`, `apps/api/vitest.int.config.ts`, `packages/db/src/ping.ts`. Modify `apps/api/package.json` (deps + `test:int`), `apps/api/src/health/health.module.ts`, `packages/db/src/index.ts`.

- [x] **Step 1: Add `ping` to `@erp/db`** (keeps drizzle's `sql` out of the api — boundary-clean)

`packages/db/src/ping.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/** Cheap connectivity probe; throws if the database is unreachable. */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
```
Add `export * from "./ping.js";` to `packages/db/src/index.ts`.

- [x] **Step 2: Wire deps + int-test lane in the api**

`apps/api/package.json`: add to `dependencies`: `"@erp/db": "workspace:*"`; to `devDependencies`: `"@testcontainers/postgresql": "catalog:"`; to `scripts`: `"test:int": "vitest run --config vitest.int.config.ts"`.
`apps/api/vitest.int.config.ts`:
```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globals: true,
    setupFiles: ["reflect-metadata"], // required for Nest DI under Vitest (D-018)
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  plugins: [swc.vite()],
});
```
Also exclude int tests from the unit lane: in `apps/api/vitest.config.ts` set `include: ["src/**/*.test.ts"], exclude: ["src/**/*.int.test.ts", "node_modules/**"]` (keep its existing `setupFiles`).
Run: `pnpm install` → lockfile updates cleanly. Then `pnpm -r build` (the api resolves `@erp/db` — including Step 1's new `ping` — via its `dist`).

- [x] **Step 3: Write the failing int test** *(tamper via `handle.pool.query` — the plan's `import("drizzle-orm")` can't resolve from the api by design)*

`apps/api/src/health/ready.int.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_VERSION, makeDb, runMigrations } from "@erp/db";
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
    const { sql } = await import("drizzle-orm");
    await handle.db.execute(
      sql`UPDATE platform_meta SET schema_version = ${EXPECTED_SCHEMA_VERSION + 99} WHERE id = 1`,
    );
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
```

- [x] **Step 4: Run it, see it fail** — Run: `pnpm --filter @erp/api test:int` → FAIL (no `/ready`, no DbModule).

- [x] **Step 5: Implement DbModule + ReadyController** *(+ biome.json `unsafeParameterDecoratorsEnabled` — first parameter decorators in repo)*

`apps/api/src/db/db.module.ts`:
```ts
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { makeDb } from "@erp/db";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

export const DB = Symbol("DB");
export type DbHandle = ReturnType<typeof makeDb>;

@Global()
@Module({
  providers: [{ provide: DB, useFactory: (cfg: AppConfig): DbHandle => makeDb(cfg.DATABASE_URL), inject: [APP_CONFIG] }],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  async onApplicationShutdown(): Promise<void> {
    await this.handle.pool.end();
  }
}
```
`apps/api/src/health/ready.controller.ts`:
```ts
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { assertSchemaVersion, ping } from "@erp/db";
import { DB, type DbHandle } from "../db/db.module.js";

@Controller()
export class ReadyController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get("ready")
  async ready(): Promise<{ status: "ready" }> {
    try {
      await ping(this.handle.db);
      await assertSchemaVersion(this.handle.db);
      return { status: "ready" };
    } catch (err) {
      throw new ServiceUnavailableException({ status: "unready", reason: (err as Error).message });
    }
  }
}
```
Wire up: add `DbModule` to `AppModule` imports; add `ReadyController` to `HealthModule` controllers.

- [x] **Step 6: Run to green** — Run: `pnpm --filter @erp/api test:int` → PASS (3). Also `pnpm --filter @erp/api test` (unit lane still green) and `pnpm --filter @erp/api build`.

- [x] **Step 7: Verify dependency-cruiser actually SEES the new cross-package edge** *(edges resolve to `packages/db/dist`; deliberate deep import failed `pnpm boundaries` as required, then clean)* (Phase-1 Task 9 flagged this: if workspace names don't resolve, the deep-import rules are silently under-enforced)

Run: `pnpm boundaries` → exit 0. Then prove resolution for real — a green run alone proves nothing, because dependency-cruiser lists unresolved specifiers too:
1. `pnpm exec depcruise --config .dependency-cruiser.cjs --output-type json apps/api/src > dep.json` and inspect the `@erp/db` edge: it must show `"couldNotResolve": false` (equivalently, a `resolved` path into `packages/db/`). If it shows `couldNotResolve: true`, add to `.dependency-cruiser.cjs` `options`: `enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "types", "default"] }` and re-check. Delete `dep.json` after.
2. **Unconditionally run the red test** (this is the only real proof the deep-import rules bite): temporarily add `import "@erp/db/src/client.js";` to `apps/api/src/main.ts`, run `pnpm boundaries` → MUST exit non-zero (`no-app-deep-import`). Remove the import, re-run → exit 0. If the violation does NOT fail the run, the rules are silently under-enforced — fix resolution before proceeding.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/ping.ts packages/db/src/index.ts apps/api .dependency-cruiser.cjs
git commit -m "feat(api): GET /ready with schema-version + connectivity gate (503 fail-closed)"
```

---

## Task 3: Tenancy + fail-closed RLS

**Files:** Create `packages/db/src/schema/rls.ts`, `packages/db/src/schema/tenancy.ts`, `packages/db/src/tenant-tx.ts`, `packages/db/src/rls.int.test.ts`, generated migration + custom migration. Modify `packages/db/drizzle.config.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`, `packages/db/src/migrate.ts` (version → 2).

- [x] **Step 1: Role + policy helper**

`packages/db/src/schema/rls.ts`:
```ts
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
```

- [x] **Step 2: Tenants table** *(fallback exercised: drizzle-kit can't resolve cross-file schema imports — `tenantCtx` inlined in tenancy.ts; NO schema file may import another schema file from here on)*

`packages/db/src/schema/tenancy.ts`:
```ts
import { sql } from "drizzle-orm";
import { pgPolicy, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantCtx } from "./rls.js";

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
```
`packages/db/src/schema/index.ts`: add `export * from "./rls.js"; export * from "./tenancy.js";`
`packages/db/drizzle.config.ts`: add the new files to `schema` (explicit list per D-017): `schema: ["./src/schema/platform.ts", "./src/schema/rls.ts", "./src/schema/tenancy.ts"]`, and add `entities: { roles: true }` so drizzle-kit generates `CREATE ROLE app_rw`.

- [x] **Step 3: Generate + review, then hand-write the custom migration** *(0001 reviewed: schema+role+table+ENABLE+policy, nothing destructive; CREATE ROLE hand-guarded idempotent after review; 0002 verbatim)*

Run: `pnpm --filter @erp/db db:generate`
Expected: a new migration creating schema `platform`, table `platform.tenants`, `CREATE ROLE "app_rw"`, the policy, and `ENABLE ROW LEVEL SECURITY`. **Review the SQL** — nothing destructive, role included (if `enableRLS` isn't emitted automatically alongside the policy, the custom migration below covers it deterministically).
Then: `pnpm --filter @erp/db exec drizzle-kit generate --custom --name=rls-force-and-grants` and fill the file:

```sql
-- Fail-closed RLS hardening + app_rw runtime privileges.
-- FORCE subjects even the table owner to RLS (superuser still bypasses; that is the
-- deliberate bootstrap/migration/relay path). Repeat ENABLE defensively.
ALTER TABLE "platform"."tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."tenants" FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "platform" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "platform" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "platform" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
-- Defense in depth on top of RLS: tenant sessions never rewrite the tenant registry,
-- and only read the meta row (no app_rw code path writes it).
REVOKE UPDATE, DELETE ON "platform"."tenants" FROM "app_rw";
GRANT SELECT ON "platform_meta" TO "app_rw";
```
> Every later migration task repeats the ENABLE/FORCE pair for its new tables and relies on the per-schema default privileges (each new PG schema gets its own GRANT/DEFAULT PRIVILEGES block when first created).
> **If `db:generate` fails to resolve the schema files' relative `.js` imports** (`./rls.js` etc. — D-017's esbuild-loader caveat hit the *barrel's* `export *`; direct relative imports are expected to work): fall back to defining the policy helper/role inline in each schema file — same SQL output, no cross-file schema imports. Verify on this first generate, not mid-phase.

Bump `packages/db/src/migrate.ts`: `EXPECTED_SCHEMA_VERSION = 2`.

- [x] **Step 4: Write the failing fail-closed tests** (test-first: `withTenantTx` doesn't exist yet — Steps 1–3 built the fixture, this drives the wrapper)

`packages/db/src/rls.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { tenants } from "./schema/tenancy.js";
import { withTenantTx } from "./tenant-tx.js";

describe("RLS is always-on and fail-closed", () => {
  let container: StartedPostgreSqlContainer;
  let handle: ReturnType<typeof makeDb>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    handle = makeDb(container.getConnectionUri());
    await runMigrations(handle.db);
    // bootstrap path: superuser inserts tenants (deliberate RLS bypass)
    await handle.db.insert(tenants).values([
      { id: tenantA, name: "A" },
      { id: tenantB, name: "B" },
    ]);
  });
  afterAll(async () => {
    await handle.pool.end();
    await container.stop();
  });

  it("a context-less app_rw session reads ZERO rows", async () => {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`); // role, but NO app.tenant_id
      return tx.select().from(tenants);
    });
    expect(rows).toHaveLength(0);
  });

  it("an empty-string tenant context reads ZERO rows (no cast error)", async () => {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`SET LOCAL ROLE app_rw`);
      return tx.select().from(tenants);
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant A sees exactly its own row, never B's", async () => {
    const rows = await withTenantTx(handle.db, { tenantId: tenantA }, (tx) => tx.select().from(tenants));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tenantA);
  });

  it("a write without tenant context is REJECTED", async () => {
    const err = await handle.db
      .transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE app_rw`);
        await tx.insert(tenants).values({ id: randomUUID(), name: "intruder" });
      })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeTruthy();
    // drizzle >= 0.44 wraps driver errors (DrizzleQueryError) — match the ROOT cause message
    const msg = String((err as { cause?: Error }).cause?.message ?? (err as Error).message);
    expect(msg).toMatch(/row-level security/i);
  });

  it("SET LOCAL context does NOT leak across transactions on a pooled connection", async () => {
    await withTenantTx(handle.db, { tenantId: tenantA }, (tx) => tx.select().from(tenants));
    const after = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_rw`);
      return tx.select().from(tenants);
    });
    expect(after).toHaveLength(0);
  });

  it("ENABLE + FORCE row security are set on EVERY tenant table (catalog assertion)", async () => {
    // Proves FORCE is really active (test connections are superuser, which bypasses RLS —
    // without this check the FORCE claim would rest on migration review alone). Scans all
    // owner-named schemas so tables added by later tasks are covered automatically.
    const res = await handle.db.execute(sql`
      SELECT n.nspname || '.' || c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('platform', 'md', 'wh', 'fin')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `);
    expect(res.rows).toEqual([]);
  });
});
```

- [x] **Step 5: Run it, see it fail** — Run: `pnpm --filter @erp/db test:int` → FAIL (`./tenant-tx.js` does not exist yet; the Step 1–3 schema/migrations are the fixture, the wrapper is what these tests drive).

- [x] **Step 6: Implement `withTenantTx`**

`packages/db/src/tenant-tx.ts`:
```ts
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
export async function withTenantTx<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE app_rw`);
    return fn(tx);
  });
}
```
`packages/db/src/index.ts`: add `export * from "./tenant-tx.js";`

- [x] **Step 7: Run to green** — Run: `pnpm --filter @erp/db test:int` → PASS (existing 2 migrate tests + 6 RLS tests). *(+ review fix `39e6803`: catalog assertion → fail-closed blocklist incl. partitioned tables)* Then `pnpm --filter @erp/db typecheck && pnpm --filter @erp/db build`.

- [x] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): tenancy + fail-closed RLS (app_rw, FORCE RLS, withTenantTx)"
```

---

## Task 4: Hash-chained immutable audit (`@erp/platform` is born)

**Files:** Create `packages/platform/{package.json,tsconfig.json,vitest.config.ts,vitest.int.config.ts}`, `packages/platform/src/{index.ts,errors.ts,stable-stringify.ts,stable-stringify.test.ts,audit.ts,audit.int.test.ts,testkit.ts}`, `packages/db/src/schema/audit.ts`, generated + custom migrations. Modify `pnpm-workspace.yaml` (catalog: fast-check), `packages/db/drizzle.config.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/migrate.ts` (version → 3).

- [x] **Step 1: Catalog + package scaffolding**

`pnpm-workspace.yaml` catalog additions:
```yaml
  pg-boss: ^12.26.0        # Context7/spec-verified 2026-07; confirm latest 12.x at execution
  fast-check: ^4.0.0       # confirm latest 4.x at execution
```
`packages/platform/package.json` (mirror the `@erp/db` pattern: ESM, same exports/scripts shape):
```json
{
  "name": "@erp/platform",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:int": "vitest run --config vitest.int.config.ts"
  },
  "dependencies": {
    "@erp/contracts": "workspace:*",
    "@erp/db": "workspace:*",
    "@erp/kernel": "workspace:*",
    "drizzle-orm": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "catalog:",
    "fast-check": "catalog:",
    "pg-boss": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
> `drizzle-orm` (the `sql`/`eq` builders) and `zod` (payload validation) are RUNTIME deps of platform source. `pg-boss` stays dev-only: the relay depends on the structural `PgBossLike` interface; only tests instantiate the real thing.
`tsconfig.json`/`vitest.config.ts`: mirror `@erp/db` (unit config includes `src/**/*.test.ts`, excludes `*.int.test.ts`; int config includes `src/**/*.int.test.ts` with 120s timeouts).
Run: `pnpm install` → clean.

- [x] **Step 2: Audit schema** *(inline schema pattern per Task-3 constraint; ON CONFLICT `AS h` alias form works on PG18)*

`packages/db/src/schema/audit.ts`:
```ts
import { integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantIsolation } from "./rls.js";
import { platformSchema } from "./tenancy.js";

/** Chain head per aggregate — row-locked on every append to serialize the chain. Mutable by design (the log is the immutable record; verify cross-checks head against log). */
export const auditHead = platformSchema.table(
  "audit_head",
  {
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    lastSeq: integer("last_seq").notNull(),
    lastHash: text("last_hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.aggregateType, t.aggregateId] }),
    tenantIsolation("audit_head_tenant_isolation"),
  ],
);

/** Append-only, hash-chained, PII-free (payload HASH only, never the payload). */
export const auditLog = platformSchema.table(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    seq: integer("seq").notNull(),
    action: text("action").notNull(),
    actor: uuid("actor"),
    correlationId: text("correlation_id"),
    payloadHash: text("payload_hash").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_log_chain_uq").on(t.tenantId, t.aggregateType, t.aggregateId, t.seq),
    tenantIsolation("audit_log_tenant_isolation"),
  ],
);
```
Add to `schema/index.ts` + `drizzle.config.ts` schema list. Run `pnpm --filter @erp/db db:generate`, review SQL. Custom migration (`--custom --name=audit-immutability`):
```sql
ALTER TABLE "platform"."audit_head" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_head" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" FORCE ROW LEVEL SECURITY;

-- Immutability: nobody updates/deletes/truncates audit rows — not even the owner.
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."audit_log" FROM PUBLIC, "app_rw";
CREATE OR REPLACE FUNCTION platform.audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform.audit_log is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "platform"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION platform.audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "platform"."audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_log_immutable();
```
Bump `EXPECTED_SCHEMA_VERSION = 3`.

- [x] **Step 3: Failing unit test for `stableStringify`**

`packages/platform/src/stable-stringify.test.ts`:
```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stableStringify } from "./stable-stringify.js";

describe("stableStringify", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("property: any two objects with the same entries stringify identically", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        return stableStringify(obj) === stableStringify(reversed);
      }),
    );
  });
});
```
Run: `pnpm --filter @erp/platform test` → FAIL. Implement `packages/platform/src/stable-stringify.ts`:
```ts
/** Deterministic JSON: objects serialize with sorted keys, recursively. For hashing only. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
```
Run → PASS.

- [x] **Step 4: Failing int tests for the audit chain**

Shared helper first — `packages/platform/src/testkit.ts`:
```ts
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { makeDb, runMigrations, schema } from "@erp/db";

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
  const err = await p.then(() => null, (e: unknown) => e);
  if (!err) throw new Error(`expected a rejection matching ${re}, got success`);
  const msg = String((err as { cause?: Error }).cause?.message ?? (err as Error).message);
  if (!re.test(msg)) throw new Error(`expected ${re}, got: ${msg}`);
}

/** Run `n` thunks with real parallelism and collect settled results. */
export async function inParallel<T>(thunks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(thunks.map((t) => t()));
}
```
`packages/platform/src/audit.int.test.ts` (excerpt — the four cases):
```ts
import fc from "fast-check";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "@erp/db";
import { appendAudit, verifyAuditChain } from "./audit.js";
import { expectPgError, inParallel, startTestDb, type TestDb } from "./testkit.js";

describe("hash-chained audit", () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await t.stop(); });

  it("appends a verifiable chain", async () => {
    const agg = { aggregateType: "StockItem", aggregateId: "it-1" };
    for (let i = 0; i < 3; i++) {
      await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        appendAudit(tx, { tenantId: t.tenantId, ...agg, action: `op-${i}`, payload: { i } }),
      );
    }
    const v = await verifyAuditChain(t.handle.db, { tenantId: t.tenantId, ...agg });
    expect(v).toEqual({ valid: true, length: 3 });
  });

  it("audit rows are immutable — UPDATE, DELETE, and TRUNCATE are blocked even for the owner", async () => {
    await expectPgError(t.handle.db.execute(sql`UPDATE platform.audit_log SET action = 'tampered'`), /append-only/);
    await expectPgError(t.handle.db.execute(sql`DELETE FROM platform.audit_log`), /append-only/);
    await expectPgError(t.handle.db.execute(sql`TRUNCATE platform.audit_log`), /append-only/);
  });

  it("a tampered chain is detected", async () => {
    // superuser can disable the trigger — exactly the tamper scenario chain-verification exists for
    await t.handle.db.execute(sql`ALTER TABLE platform.audit_log DISABLE TRIGGER audit_log_no_update_delete`);
    await t.handle.db.execute(sql`UPDATE platform.audit_log SET payload_hash = 'forged' WHERE seq = 2`);
    await t.handle.db.execute(sql`ALTER TABLE platform.audit_log ENABLE TRIGGER audit_log_no_update_delete`);
    const v = await verifyAuditChain(t.handle.db, { tenantId: t.tenantId, aggregateType: "StockItem", aggregateId: "it-1" });
    expect(v.valid).toBe(false);
  });

  it("a WIPED chain is detected (head seq vs log length)", async () => {
    // an attacker deleting log rows while the head remains must not verify clean
    const agg = { aggregateType: "WipeAgg", aggregateId: "w-1" };
    await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
      appendAudit(tx, { tenantId: t.tenantId, ...agg, action: "op", payload: {} }),
    );
    await t.handle.db.execute(sql`ALTER TABLE platform.audit_log DISABLE TRIGGER audit_log_no_update_delete`);
    await t.handle.db.execute(sql`DELETE FROM platform.audit_log WHERE aggregate_type = 'WipeAgg'`);
    await t.handle.db.execute(sql`ALTER TABLE platform.audit_log ENABLE TRIGGER audit_log_no_update_delete`);
    const v = await verifyAuditChain(t.handle.db, { tenantId: t.tenantId, ...agg });
    expect(v.valid).toBe(false);
  });

  it("property: concurrent appends across aggregates keep every chain dense and valid", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 4, maxLength: 12 }),
        async (aggPicks) => {
          const run = crypto.randomUUID();
          await inParallel(
            aggPicks.map((pick, i) => () =>
              withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
                appendAudit(tx, {
                  tenantId: t.tenantId, aggregateType: "PropAgg", aggregateId: `${run}-${pick}`,
                  action: `op-${i}`, payload: { i },
                }),
              ),
            ),
          );
          for (const pick of new Set(aggPicks)) {
            const v = await verifyAuditChain(t.handle.db, { tenantId: t.tenantId, aggregateType: "PropAgg", aggregateId: `${run}-${pick}` });
            if (!v.valid) return false;
          }
          return true;
        },
      ),
      { numRuns: 15 },
    );
  });
});
```
Also add the standard **RLS probes** (cross-tenant read of `audit_log` → 0 rows; context-less → 0 rows).
Run: `pnpm -r build && pnpm --filter @erp/platform test:int` → FAIL.

- [x] **Step 5: Implement `appendAudit` / `verifyAuditChain`** *(+ review fix `09131d2`: repeatable-read snapshot verify, uuid normalization, stableStringify toJSON/undefined edge cases, ABBA-deadlock rule documented)*

`packages/platform/src/audit.ts`:
```ts
import { createHash } from "node:crypto";
import { asc, and, eq, sql } from "drizzle-orm";
import { newId } from "@erp/kernel";
import { type Db, type Tx, schema } from "@erp/db";
import { stableStringify } from "./stable-stringify.js";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface AuditEntry {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  actor?: string | null;
  correlationId?: string | null;
  /** Hashed (stableStringify → sha256), NEVER stored — the log is PII-free by construction. */
  payload: unknown;
}

/** Append one link to the aggregate's hash chain. MUST run inside the same tx as the business write. */
export async function appendAudit(tx: Tx, e: AuditEntry): Promise<{ seq: number; hash: string }> {
  // Upsert-with-self-assignment takes the head's row lock (serializes the chain per
  // aggregate, race-safe including first-ever append) and returns the current head.
  const head = await tx.execute(sql`
    INSERT INTO platform.audit_head AS h (tenant_id, aggregate_type, aggregate_id, last_seq, last_hash)
    VALUES (${e.tenantId}, ${e.aggregateType}, ${e.aggregateId}, 0, '')
    ON CONFLICT (tenant_id, aggregate_type, aggregate_id)
    DO UPDATE SET last_seq = h.last_seq
    RETURNING h.last_seq AS last_seq, h.last_hash AS last_hash
  `);
  const row = head.rows[0] as { last_seq: number; last_hash: string };
  const seq = row.last_seq + 1;
  const prevHash = row.last_hash;
  const payloadHash = sha256(stableStringify(e.payload));
  const hash = sha256(
    JSON.stringify([prevHash, e.tenantId, e.aggregateType, e.aggregateId, seq, e.action, e.actor ?? null, e.correlationId ?? null, payloadHash]),
  );
  await tx.insert(schema.auditLog).values({
    id: newId(), tenantId: e.tenantId, aggregateType: e.aggregateType, aggregateId: e.aggregateId,
    seq, action: e.action, actor: e.actor ?? null, correlationId: e.correlationId ?? null,
    payloadHash, prevHash, hash,
  });
  await tx
    .update(schema.auditHead)
    .set({ lastSeq: seq, lastHash: hash })
    .where(and(
      eq(schema.auditHead.tenantId, e.tenantId),
      eq(schema.auditHead.aggregateType, e.aggregateType),
      eq(schema.auditHead.aggregateId, e.aggregateId),
    ));
  return { seq, hash };
}

export interface ChainRef { tenantId: string; aggregateType: string; aggregateId: string; }
export type ChainVerdict = { valid: true; length: number } | { valid: false; brokenAtSeq: number; reason: string };

/** Recompute the whole chain from the log and cross-check the head. Runs on any handle (worker cron uses the owner connection). */
export async function verifyAuditChain(db: Db, ref: ChainRef): Promise<ChainVerdict> {
  const rows = await db.select().from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.tenantId, ref.tenantId),
      eq(schema.auditLog.aggregateType, ref.aggregateType),
      eq(schema.auditLog.aggregateId, ref.aggregateId),
    ))
    .orderBy(asc(schema.auditLog.seq));
  let prev = "";
  for (const [i, r] of rows.entries()) {
    if (r.seq !== i + 1) return { valid: false, brokenAtSeq: r.seq, reason: "sequence gap" };
    if (r.prevHash !== prev) return { valid: false, brokenAtSeq: r.seq, reason: "prev-hash mismatch" };
    const expect = sha256(
      JSON.stringify([r.prevHash, r.tenantId, r.aggregateType, r.aggregateId, r.seq, r.action, r.actor, r.correlationId, r.payloadHash]),
    );
    if (r.hash !== expect) return { valid: false, brokenAtSeq: r.seq, reason: "hash mismatch" };
    prev = r.hash;
  }
  const [head] = await db.select().from(schema.auditHead)
    .where(and(
      eq(schema.auditHead.tenantId, ref.tenantId),
      eq(schema.auditHead.aggregateType, ref.aggregateType),
      eq(schema.auditHead.aggregateId, ref.aggregateId),
    ));
  // A wiped/truncated log must not verify clean: the head's seq is the expected length.
  const headSeq = head?.lastSeq ?? 0;
  if (headSeq !== rows.length) {
    return { valid: false, brokenAtSeq: rows.length, reason: `head seq ${headSeq} != log length ${rows.length}` };
  }
  if (rows.length > 0 && head?.lastHash !== prev) return { valid: false, brokenAtSeq: rows.length, reason: "head mismatch" };
  return { valid: true, length: rows.length };
}
```
`packages/platform/src/errors.ts` starts here (just the base class — concrete members accrue per task, first in Task 5; YAGNI: no error class before its thrower exists):
```ts
export abstract class DomainError extends Error {
  abstract readonly code: string;
}
```
`packages/platform/src/index.ts`: export errors, stable-stringify, audit.

- [x] **Step 6: Run to green** — `pnpm -r build && pnpm --filter @erp/platform test && pnpm --filter @erp/platform test:int` → PASS. `pnpm --filter @erp/db test:int` still green. `pnpm boundaries` exit 0.

- [x] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/platform packages/db
git commit -m "feat(platform): hash-chained immutable audit log with per-aggregate head locking"
```

---

## Task 5: Transactional outbox + `apps/worker` + pg-boss relay

**Files:** Create `packages/db/src/schema/outbox.ts`, `packages/platform/src/{outbox.ts,outbox-relay.ts,outbox-relay.int.test.ts}`, `apps/worker/*` (full scaffold per the file structure), migrations. Modify `packages/db/drizzle.config.ts` + `schema/index.ts`, `migrate.ts` (version → 4), `packages/platform/src/index.ts`, `.env.example` (`RELAY_INTERVAL_MS=1000`).

- [x] **Step 1: Outbox + archive schema** *(partial-index `.where` form worked — no fallback needed)*

`packages/db/src/schema/outbox.ts`:
```ts
import { sql } from "drizzle-orm";
import { index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantIsolation } from "./rls.js";
import { platformSchema } from "./tenancy.js";

const envelopeColumns = {
  id: uuid("id").primaryKey(), // = eventId
  tenantId: uuid("tenant_id").notNull(),
  type: text("type").notNull(),
  eventVersion: integer("event_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  actor: uuid("actor"),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  payload: jsonb("payload").notNull(),
};

export const outbox = platformSchema.table(
  "outbox",
  {
    ...envelopeColumns,
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    relayedAt: timestamp("relayed_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_unrelayed_idx").on(t.createdAt).where(sql`relayed_at IS NULL`),
    tenantIsolation("outbox_tenant_isolation"),
  ],
);

/** Durable, never-pruned replay/audit log of every relayed event (spec §9.2). */
export const eventArchive = platformSchema.table(
  "event_archive",
  {
    ...envelopeColumns,
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolation("event_archive_tenant_isolation")],
);
```
(If the drizzle 0.45 partial-index `.where` form differs at execution, fall back to a plain index on `(relayed_at, created_at)` — semantics, not shape, is what matters.)
Generate + review; custom migration `--custom --name=outbox-rls-force`:
```sql
ALTER TABLE "platform"."outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."outbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."event_archive" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."event_archive" FORCE ROW LEVEL SECURITY;
-- App sessions APPEND and read the outbox; only the (superuser) relay marks/deletes.
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."outbox" FROM "app_rw";
-- The archive is never pruned (spec §9.2) and written only by the relay.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "platform"."event_archive" FROM "app_rw";
```
Bump `EXPECTED_SCHEMA_VERSION = 4`.

- [x] **Step 2: `appendOutbox`** *(NOTE — Steps 2–3 are the reference implementations for this task's code; in execution order, write Step 4's failing tests FIRST, see them fail, then implement Steps 2–3 to green, per the TDD convention.)*

`packages/platform/src/outbox.ts`:
```ts
import type { DomainEvent } from "@erp/kernel";
import { type Tx, schema } from "@erp/db";
import { EVENT_SCHEMAS } from "@erp/contracts";
import { InvalidEventPayloadError } from "./errors.js";

/** Persist a domain event in the SAME transaction as the business write + audit row. */
export async function appendOutbox(tx: Tx, event: DomainEvent): Promise<void> {
  // Unregistered event types skip validation (lets tests use ad-hoc types).
  // TODO(Phase 3): strict / warn-on-unregistered once real consumers exist —
  // a typo'd production event type must not silently bypass validation forever.
  const versions = EVENT_SCHEMAS[event.type];
  const eventSchema = versions?.[event.eventVersion];
  if (eventSchema) {
    const parsed = eventSchema.safeParse(event.payload);
    if (!parsed.success) throw new InvalidEventPayloadError(event.type, parsed.error.message);
  }
  await tx.insert(schema.outbox).values({
    id: event.eventId, tenantId: event.tenantId, type: event.type, eventVersion: event.eventVersion,
    occurredAt: new Date(event.occurredAt), actor: event.actor, correlationId: event.correlationId,
    causationId: event.causationId ?? null, payload: event.payload,
  });
}
```
`packages/contracts/src/events/registry.ts` (starts empty; stock/fiscal tasks fill it):
```ts
import type { z } from "zod";
export const EVENT_SCHEMAS: Record<string, Record<number, z.ZodType>> = {};
```
Add `InvalidEventPayloadError` to `errors.ts`; export from barrels.

- [x] **Step 3: The relay** *(pg-boss 12 exports `PgBoss` named, not default; `ANY(ARRAY[...]::uuid[])` via sql.join; occurred_at string-normalized)*

`packages/platform/src/outbox-relay.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Db } from "@erp/db";

/** Structural slice of pg-boss the relay needs (tests may pass the real PgBoss instance). */
export interface PgBossLike {
  send(name: string, data: object, options?: { singletonKey?: string }): Promise<string | null>;
}

/** Maps event types to the pg-boss queues that consume them. Phase 2 prod registry is empty. */
export class ConsumerRegistry {
  constructor(private readonly map: Record<string, string[]> = {}) {}
  queuesFor(eventType: string): string[] {
    return this.map[eventType] ?? [];
  }
  allQueues(): string[] {
    return [...new Set(Object.values(this.map).flat())];
  }
}

/**
 * Drain one batch: claim unrelayed rows (SKIP LOCKED — safe with concurrent relays),
 * archive each (idempotent), fan out one job per consumer queue (singletonKey = eventId
 * gives best-effort dedupe while queued; consumers MUST be idempotent — delivery is
 * at-least-once by design), then mark relayed. Runs on the worker's owner connection:
 * cross-tenant infrastructure that never mutates domain tables.
 */
export async function relayOutboxBatch(
  db: Db,
  boss: PgBossLike,
  registry: ConsumerRegistry,
  opts: { batchSize?: number } = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? 50;
  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      SELECT id, tenant_id, type, event_version, occurred_at, actor, correlation_id, causation_id, payload
      FROM platform.outbox WHERE relayed_at IS NULL
      ORDER BY created_at LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);
    for (const r of claimed.rows as Array<Record<string, unknown>>) {
      await tx.execute(sql`
        INSERT INTO platform.event_archive (id, tenant_id, type, event_version, occurred_at, actor, correlation_id, causation_id, payload)
        VALUES (${r.id}, ${r.tenant_id}, ${r.type}, ${r.event_version}, ${r.occurred_at}, ${r.actor}, ${r.correlation_id}, ${r.causation_id}, ${JSON.stringify(r.payload)}::jsonb)
        ON CONFLICT (id) DO NOTHING
      `);
      // Jobs carry the CANONICAL §8 DomainEvent envelope (camelCase), not the raw SQL row —
      // this is the wire contract Phase-3 consumers build against.
      const envelope = {
        eventId: r.id as string,
        type: r.type as string,
        eventVersion: r.event_version as number,
        occurredAt: (r.occurred_at as Date).toISOString(),
        tenantId: r.tenant_id as string,
        actor: (r.actor as string | null) ?? null,
        correlationId: r.correlation_id as string,
        ...(r.causation_id ? { causationId: r.causation_id as string } : {}),
        payload: r.payload,
      };
      for (const queue of registry.queuesFor(envelope.type)) {
        await boss.send(queue, envelope, { singletonKey: envelope.eventId });
      }
    }
    if (claimed.rows.length > 0) {
      const ids = (claimed.rows as Array<{ id: string }>).map((r) => r.id);
      await tx.execute(sql`UPDATE platform.outbox SET relayed_at = now() WHERE id = ANY(${ids}::uuid[])`);
    }
    return claimed.rows.length;
  });
}
```

- [x] **Step 4: Failing relay int test**

`packages/platform/src/outbox-relay.int.test.ts` — cases (write them, see them fail, then wire green):
1. **Same-tx write + relay round trip:** inside one `withTenantTx`: `appendAudit` + `appendOutbox(createEvent(...))` (a `TestThingHappened` v1 event; kernel `createEvent` with the test tenant). Then start a real `PgBoss` on `container.getConnectionUri()` (`await boss.start()`; `await boss.createQueue("test-queue")`), registry `{ TestThingHappened: ["test-queue"] }`, run `relayOutboxBatch` → returns 1; assert: `event_archive` has the row; `outbox.relayed_at` set; `boss.fetch("test-queue")` returns the job whose data is the **camelCase DomainEvent envelope** (`eventId`/`tenantId`/`eventVersion`/`occurredAt`/`correlationId`/`payload` — assert the keys, not the raw snake_case row).
2. **Idempotent re-run:** run `relayOutboxBatch` again → returns 0; archive still has exactly 1 row; no new job.
3. **Crash-recovery duplicate is tolerated:** simulate publish-then-crash by resetting `relayed_at = NULL` for the row (superuser) and relaying again → archive unchanged (`ON CONFLICT DO NOTHING`), and the job count is ≤ 2 — the test documents **at-least-once**: a consumer-side duplicate is possible and consumers must dedupe by `eventId` (spec §8 idempotency).
4. **Rollback writes nothing:** run a `withTenantTx` that appends outbox then throws → outbox row absent.
5. **RLS probes** on `outbox` AND `event_archive` (cross-tenant/context-less → 0 rows; an `app_rw` session's INSERT into the archive → permission denied, per the revoke).
Teardown: `await boss.stop()` before the container stops.
Run: `pnpm -r build && pnpm --filter @erp/platform test:int` → FAIL → implement Steps 2–3 → PASS.

- [x] **Step 5: `apps/worker` scaffold (born ESM)**

`apps/worker/package.json` — mirror `apps/api` (name `@erp/worker`, `"type": "module"`, same scripts + `test:int`), dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs`, `zod`, `pg-boss: "catalog:"`, `@erp/db`, `@erp/platform` (workspace:*); devDependencies mirror the api (`@nestjs/cli`, `@nestjs/testing`, `@swc/cli`, `@swc/core`, `unplugin-swc`, `typescript`, `vitest`, `@testcontainers/postgresql`) **plus `"@erp/kernel": "workspace:*"`** — the int test builds a `TestThingHappened` event with kernel `createEvent`, and the platform barrel does not re-export it. Copy the api's `.swcrc` (with the `module: es6` block), `nest-cli.json`, `tsconfig.json`, vitest configs. **Finish the scaffold with `pnpm install`** (new workspace package + new deps → lockfile updates; it is staged in Step 8).
`apps/worker/src/config/env.ts` (+ unit test, mirroring the api's env test):
```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
});
export type WorkerConfig = z.infer<typeof EnvSchema>;

/** DI token lives HERE (a leaf module) — not in worker.module.ts — so relay.service.ts
 * never imports the module back (circular ESM imports leave the token in TDZ at
 * decorator-evaluation time). */
export const WORKER_CONFIG = Symbol("WORKER_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker configuration: ${issues}`);
  }
  return parsed.data;
}
```
`apps/worker/src/registry.ts`:
```ts
import { ConsumerRegistry } from "@erp/platform";
/** Phase 2: no consumers yet — Phase 3+ registers queues here. */
export const PROD_REGISTRY = new ConsumerRegistry({});
```
`apps/worker/src/relay/relay.service.ts`:
```ts
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import PgBoss from "pg-boss";
import { assertSchemaVersion, makeDb } from "@erp/db";
import { type ConsumerRegistry, relayOutboxBatch, verifyAuditChain } from "@erp/platform";
import { WORKER_CONFIG, type WorkerConfig } from "../config/env.js";
import { PROD_REGISTRY } from "../registry.js";

export const CHAIN_VERIFY_QUEUE = "audit-chain-verify";

@Injectable()
export class RelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(RelayService.name);
  private handle!: ReturnType<typeof makeDb>;
  private boss!: PgBoss;
  private timer?: NodeJS.Timeout;
  private draining = false;
  readonly registry: ConsumerRegistry = PROD_REGISTRY;

  constructor(@Inject(WORKER_CONFIG) private readonly cfg: WorkerConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.handle = makeDb(this.cfg.DATABASE_URL);
      await assertSchemaVersion(this.handle.db); // boot gate: fail closed like the api
      this.boss = new PgBoss(this.cfg.DATABASE_URL);
      this.boss.on("error", (err) => this.log.error(err));
      await this.boss.start();
      for (const q of [CHAIN_VERIFY_QUEUE, ...this.registry.allQueues()]) await this.boss.createQueue(q);
      await this.boss.schedule(CHAIN_VERIFY_QUEUE, "0 3 * * *", {}, {});
      await this.boss.work(CHAIN_VERIFY_QUEUE, async () => this.verifyChains());
      this.timer = setInterval(() => void this.tick(), this.cfg.RELAY_INTERVAL_MS);
      this.log.log(`outbox relay every ${this.cfg.RELAY_INTERVAL_MS}ms`);
    } catch (err) {
      // A failed init never receives onApplicationShutdown — release whatever we grabbed
      // (else the boot-gate test leaks a live pool that explodes when the container stops,
      // and a crash-looping prod worker leaks one connection per attempt), then rethrow.
      await this.boss?.stop().catch(() => {});
      await this.handle?.pool.end().catch(() => {});
      throw err;
    }
  }

  /** Reentrancy-guarded drain tick. */
  async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let n: number;
      do {
        n = await relayOutboxBatch(this.handle.db, this.boss, this.registry);
      } while (n > 0);
    } catch (err) {
      this.log.error(err);
    } finally {
      this.draining = false;
    }
  }

  private async verifyChains(): Promise<void> {
    const heads = await this.handle.db.select().from((await import("@erp/db")).schema.auditHead);
    for (const h of heads) {
      const v = await verifyAuditChain(this.handle.db, { tenantId: h.tenantId, aggregateType: h.aggregateType, aggregateId: h.aggregateId });
      if (!v.valid) this.log.error(`AUDIT CHAIN BROKEN ${h.aggregateType}/${h.aggregateId}: ${JSON.stringify(v)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.boss?.stop();
    await this.handle?.pool.end();
  }
}
```
(The dynamic `import("@erp/db")` in `verifyChains` is ugly — replace with a top-level `import { schema } from "@erp/db"` and use `schema.auditHead`; written out here to flag it: the implementer should use the static import.)
`apps/worker/src/worker.module.ts` + `main.ts`:
```ts
// worker.module.ts
import { Module } from "@nestjs/common";
import { WORKER_CONFIG, loadConfig } from "./config/env.js";
import { RelayService } from "./relay/relay.service.js";

@Module({
  providers: [{ provide: WORKER_CONFIG, useFactory: () => loadConfig() }, RelayService],
})
export class WorkerModule {}

// main.ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

async function bootstrap() {
  const ctx = await NestFactory.createApplicationContext(WorkerModule);
  ctx.enableShutdownHooks();
}
void bootstrap();
```

- [x] **Step 6: Failing worker int test → green**

`apps/worker/src/worker.int.test.ts`: (1) boot `WorkerModule` (via `Test.createTestingModule` + `init()`) against a migrated Testcontainers DB → bootstrap succeeds, then `close()` cleanly; (2) tamper `platform_meta.schema_version` → boot **rejects** (assertSchemaVersion throws) — then **restore it with `runMigrations`** before the next case (the api test shows the pattern); (3) end-to-end drain: with the app context up, `withTenantTx` + `appendOutbox` a `TestThingHappened` event → poll until `relayed_at` is set and the row is in `event_archive` (≤ 5s). Queue fan-out with a populated registry is already covered by the platform relay test — `PROD_REGISTRY` is empty here and that is fine; do NOT add registry-override machinery for this test.
Run: `pnpm -r build && pnpm --filter @erp/worker test && pnpm --filter @erp/worker test:int` → iterate to PASS. `pnpm boundaries` exit 0.

- [x] **Step 7: `.env.example`** — add `RELAY_INTERVAL_MS=1000`.

- [x] **Step 8: Commit** *(+ review fixup `008da67`: poison-row TODO(Phase 3), FORCE-RLS superuser-connection comment, archive-visibility caveat, worker boot failure handler)*

```bash
git add packages/db packages/platform packages/contracts apps/worker .env.example pnpm-lock.yaml
git commit -m "feat(platform,worker): transactional outbox, event archive, pg-boss relay worker"
```

---

## Task 6: Materials stub + stock reservation / ATP

**Files:** Create `packages/db/src/schema/masterdata.ts`, `packages/db/src/schema/stock.ts`, `packages/platform/src/stock.ts`, `packages/platform/src/stock.int.test.ts`, `packages/contracts/src/events/stock.ts`, migrations. Modify registries/barrels/config, `migrate.ts` (version → 5).

- [x] **Step 1: Schema** *(FK via `.references()` failed at drizzle-kit load — FKs shipped as plain SQL in the custom migration, D-017 pattern)*

`packages/db/src/schema/masterdata.ts`:
```ts
import { pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantIsolation } from "./rls.js";

export const mdSchema = pgSchema("md");

/** Minimal stub so stock gets a real FK from birth; Phase-3 MDM expands it (expand/contract). */
export const materials = mdSchema.table(
  "materials",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    baseUom: text("base_uom").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("materials_tenant_sku_uq").on(t.tenantId, t.sku), tenantIsolation("materials_tenant_isolation")],
);
```
`packages/db/src/schema/stock.ts`:
```ts
import { sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { materials } from "./masterdata.js";
import { tenantIsolation } from "./rls.js";

export const whSchema = pgSchema("wh");

export const stockItems = whSchema.table(
  "stock_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    onHand: numeric("on_hand", { precision: 18, scale: 6 }).notNull().default("0"),
    reserved: numeric("reserved", { precision: 18, scale: 6 }).notNull().default("0"),
    allowNegative: boolean("allow_negative").notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_items_tenant_material_uq").on(t.tenantId, t.materialId),
    check("stock_reserved_nonneg", sql`reserved >= 0`),
    check("stock_no_oversell", sql`allow_negative OR reserved <= on_hand`),
    tenantIsolation("stock_items_tenant_isolation"),
  ],
);

export const stockReservations = whSchema.table(
  "stock_reservations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    stockItemId: uuid("stock_item_id").notNull().references(() => stockItems.id),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    kind: text("kind").notNull(), // 'soft' | 'hard'
    status: text("status").notNull().default("active"), // 'active' | 'released' | 'consumed'
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  () => [
    check("reservation_qty_positive", sql`qty > 0`),
    check("reservation_kind", sql`kind IN ('soft','hard')`),
    check("reservation_status", sql`status IN ('active','released','consumed')`),
    tenantIsolation("stock_reservations_tenant_isolation"),
  ],
);
```
Generate + review; custom migration `--custom --name=md-wh-rls-force`: ENABLE/FORCE all three tables + `GRANT USAGE ON SCHEMA md, wh TO app_rw` + per-schema GRANT/DEFAULT PRIVILEGES (as in Task 3). Bump `EXPECTED_SCHEMA_VERSION = 5`.
> The DB CHECKs are the belt-and-braces backstop; the atomic UPDATE guard below is the primary invariant. The negative-stock policy is per stock item (`allow_negative`), satisfying "configurable negative-stock policy" without a config table.

- [x] **Step 2: Event contracts**

`packages/contracts/src/events/stock.ts`:
```ts
import { z } from "zod";

/** All quantities travel as decimal STRINGS (spec §6). */
const qty = z.string().regex(/^-?\d+(\.\d+)?$/);

export const StockReservedV1 = z.object({
  stockItemId: z.uuid(), materialId: z.uuid(), qty, kind: z.enum(["soft", "hard"]), ref: z.string().nullable(),
});
export const StockReservationReleasedV1 = z.object({ reservationId: z.uuid(), stockItemId: z.uuid(), qty });
export const StockReservationConsumedV1 = z.object({ reservationId: z.uuid(), stockItemId: z.uuid(), qty });
export const StockAdjustedV1 = z.object({ stockItemId: z.uuid(), delta: qty, reason: z.string(), postingDate: z.string() });
```
Register in `events/registry.ts`:
```ts
import type { z } from "zod";
import { StockAdjustedV1, StockReservationConsumedV1, StockReservationReleasedV1, StockReservedV1 } from "./stock.js";
export const EVENT_SCHEMAS: Record<string, Record<number, z.ZodType>> = {
  StockReserved: { 1: StockReservedV1 },
  StockReservationReleased: { 1: StockReservationReleasedV1 },
  StockReservationConsumed: { 1: StockReservationConsumedV1 },
  StockAdjusted: { 1: StockAdjustedV1 },
};
```
Export from the contracts barrel; add a unit test that each schema round-trips a valid payload and rejects a float-typed qty (`qty: 1.5` as number → fail).

- [x] **Step 3: Failing stock int tests** (write ALL of these first; run `pnpm -r build && pnpm --filter @erp/platform test:int` → FAIL)

`packages/platform/src/stock.int.test.ts` — cases:
1. **reserve happy path:** seed material + stock item (`on_hand: "100"`) as superuser; `withTenantTx` → `reserve(tx, { tenantId, stockItemId, qty: "30", kind: "hard", actor: null })` → counter `reserved = 30`; one active ledger row; one audit row (`action: "stock.reserve"`); one outbox `StockReserved` row — **all present in DB after the single tx**.
2. **oversell rejected:** `reserve(qty: "80")` after 30 reserved → throws `InsufficientStockError`; counters unchanged; NO ledger/audit/outbox rows from the failed call.
3. **allow_negative honored:** item with `allowNegative: true` accepts `reserve` beyond on-hand.
4. **release/consume:** release returns qty to available (counter −, ledger status `released`); consume decrements both `reserved` and `on_hand` (status `consumed`); each writes audit + event.
5. **getAvailable = on_hand − reserved.**
6. **PROPERTY — concurrent reserves never oversell and the ledger always reconciles:**
```ts
it("property: N concurrent reserves — no oversell, ledger sum == reserved counter", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 20, max: 120 }),                                  // on-hand
      fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 6, maxLength: 10 }), // concurrent qtys
      async (onHand, qtys) => {
        const itemId = await seedItem(t, String(onHand));                 // fresh item per run
        const results = await inParallel(
          qtys.map((q) => () =>
            withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
              reserve(tx, { tenantId: t.tenantId, stockItemId: itemId, qty: String(q), kind: "hard", actor: null }),
            ),
          ),
        );
        const failed = results.filter((r) => r.status === "rejected");
        // every rejection must be the domain error, nothing else
        for (const f of failed) if (!/insufficient stock/i.test(String((f as PromiseRejectedResult).reason))) return false;
        const item = await getItem(t, itemId);
        const ledgerSum = await activeLedgerSum(t, itemId);
        const reservedOk = Number(item.reserved) <= onHand && Number(item.reserved) === ledgerSum;
        const successSum = qtys.filter((_, i) => results[i]?.status === "fulfilled").reduce((a, b) => a + b, 0);
        // NOTE deliberately NO "at least one succeeds" assertion — a run where every qty
        // exceeds on-hand is legitimate, and all-rejected is then CORRECT behavior.
        return reservedOk && Number(item.reserved) === successSum;
      },
    ),
    { numRuns: 25 },
  );
});
```
(`seedItem`/`getItem`/`activeLedgerSum` are small local helpers using the superuser handle.)
7. **RLS probes:** tenant B sees none of tenant A's rows on `materials`, `stock_items`, AND `stock_reservations`; context-less → 0 rows on all three.
8. **`appendOutbox` rejects malformed payloads** (first task with a populated registry, so the reject path is testable here): build a `StockReserved` v1 event via `createEvent` whose payload lacks `qty` → `appendOutbox` throws `InvalidEventPayloadError` and writes NO outbox row.

- [x] **Step 4: Implement `packages/platform/src/stock.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { asTenantId, asUserId, createEvent, newId } from "@erp/kernel";
import { type Tx, schema } from "@erp/db";
import { appendAudit } from "./audit.js";
import { appendOutbox } from "./outbox.js";
import { InsufficientStockError, ReservationNotActiveError, StockItemNotFoundError } from "./errors.js";

export interface ReserveInput {
  tenantId: string; stockItemId: string; qty: string; kind: "soft" | "hard";
  actor: string | null; ref?: string | null; correlationId?: string;
}

/** Atomic reservation: serialized decrement via a guarded UPDATE — never an async round-trip (spec §5 rule 3). */
export async function reserve(tx: Tx, input: ReserveInput): Promise<{ reservationId: string }> {
  const updated = await tx
    .update(schema.stockItems)
    .set({
      reserved: sql`${schema.stockItems.reserved} + ${input.qty}::numeric`,
      version: sql`${schema.stockItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(schema.stockItems.id, input.stockItemId),
      sql`(${schema.stockItems.allowNegative} OR ${schema.stockItems.onHand} - ${schema.stockItems.reserved} >= ${input.qty}::numeric)`,
    ))
    .returning({ materialId: schema.stockItems.materialId });
  if (updated.length === 0) {
    const exists = await tx.select({ id: schema.stockItems.id }).from(schema.stockItems).where(eq(schema.stockItems.id, input.stockItemId));
    if (exists.length === 0) throw new StockItemNotFoundError(input.stockItemId);
    throw new InsufficientStockError(input.stockItemId, input.qty);
  }
  const reservationId = newId();
  await tx.insert(schema.stockReservations).values({
    id: reservationId, tenantId: input.tenantId, stockItemId: input.stockItemId,
    qty: input.qty, kind: input.kind, ref: input.ref ?? null,
  });
  await appendAudit(tx, {
    tenantId: input.tenantId, aggregateType: "StockItem", aggregateId: input.stockItemId,
    action: "stock.reserve", actor: input.actor, correlationId: input.correlationId ?? null,
    payload: { reservationId, qty: input.qty, kind: input.kind },
  });
  await appendOutbox(tx, createEvent({
    type: "StockReserved", eventVersion: 1,
    tenantId: asTenantId(input.tenantId), actor: input.actor ? asUserId(input.actor) : null,
    occurredAt: new Date(),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    payload: { stockItemId: input.stockItemId, materialId: updated[0]!.materialId, qty: input.qty, kind: input.kind, ref: input.ref ?? null },
  }));
  return { reservationId };
}
```
`release` / `consume` follow the same shape (guarded status transition `active → released|consumed` — 0 rows → `ReservationNotActiveError`; counter update `reserved - qty` (+ `on_hand - qty` for consume); audit + event). `adjustOnHand(tx, { tenantId, stockItemId, delta, reason, postingDate, actor })`: guarded `on_hand + delta` UPDATE with the same no-oversell predicate (`allow_negative OR on_hand + delta - reserved >= 0`… careful: predicate is `(allow_negative OR (on_hand + ${delta}::numeric) >= reserved)`), audit `stock.adjust`, event `StockAdjusted`. `postingDate: string` (`YYYY-MM-DD`) is part of `adjustOnHand`'s signature AND the event payload from birth (the registered schema requires it); the fiscal GATE on it arrives in Task 9. `getAvailable(tx, stockItemId)`: `SELECT on_hand - reserved`. Add the three error classes to `errors.ts`. Export all from the barrel.

- [x] **Step 5: Run to green** — `pnpm -r build && pnpm --filter @erp/platform test:int` → PASS (audit + outbox + stock suites). `pnpm --filter @erp/contracts test` → PASS.

- [x] **Step 6: Commit**

```bash
git add packages/db packages/platform packages/contracts
git commit -m "feat(platform): stock reservation/ATP with concurrency property tests"
```

---

## Task 7: Optimistic locking (one-winner under concurrency)

**Files:** Modify `packages/platform/src/stock.ts` (+ its int test), `packages/platform/src/errors.ts`.

- [x] **Step 1: Failing tests**

Add to `stock.int.test.ts`:
1. **stale version rejected:** read item (`version = v`); `adjustOnHand({ …, postingDate: "2026-07-15", expectedVersion: v })` succeeds and bumps to `v+1`; a second adjust with the SAME `expectedVersion: v` throws `VersionConflictError` carrying `{ expected: v, actual: v + 1 }`; state reflects exactly one adjustment. (All Task-7 adjust calls pass `postingDate: "2026-07-15"` — the field exists since Task 6; the fiscal GATE doesn't exist until Task 9, so no periods are needed here.)
2. **PROPERTY — N concurrent same-version writers, exactly one wins:**
```ts
it("property: exactly one of N same-version concurrent writers wins", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 3, max: 8 }), async (n) => {
      const itemId = await seedItem(t, "1000");
      const v = (await getItem(t, itemId)).version;
      const results = await inParallel(
        Array.from({ length: n }, () => () =>
          withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
            adjustOnHand(tx, { tenantId: t.tenantId, stockItemId: itemId, delta: "1", reason: "prop", postingDate: "2026-07-15", actor: null, expectedVersion: v }),
          ),
        ),
      );
      const wins = results.filter((r) => r.status === "fulfilled").length;
      const conflicts = results.filter((r) => r.status === "rejected" && /version conflict/i.test(String((r as PromiseRejectedResult).reason))).length;
      const item = await getItem(t, itemId);
      return wins === 1 && conflicts === n - 1 && Number(item.onHand) === 1001 && item.version === v + 1;
    }),
    { numRuns: 15 },
  );
});
```
3. **retry loop converges:** N workers each loop `read version → adjust(expectedVersion)` on conflict (max 20 attempts) → all N eventually succeed exactly once; final `on_hand = initial + N`, `version = initial + N`.
Run: `pnpm -r build && pnpm --filter @erp/platform test:int` → FAIL (no `expectedVersion` support).

- [x] **Step 2: Implement**

In `adjustOnHand`, accept `expectedVersion?: number`; when present add `eq(schema.stockItems.version, expectedVersion)` to the WHERE. On 0 rows: re-select — missing → `StockItemNotFoundError`; guard-failed with a version mismatch → `VersionConflictError(expected, actual)` (message contains "version conflict"); otherwise `InsufficientStockError`. Add `VersionConflictError { readonly code = "VERSION_CONFLICT"; constructor(public expected: number, public actual: number) … }` to `errors.ts`.
> This is the execute-time version-guard pattern AI proposals reuse in Phase 4 (spec §6): compare at write time inside the tx; stale → fail, never silent overwrite. The HTTP 409 mapping lands when real endpoints exist.

- [x] **Step 3: Run to green** — `pnpm -r build && pnpm --filter @erp/platform test:int` → PASS.

- [x] **Step 4: Commit**

```bash
git add packages/platform
git commit -m "feat(platform): optimistic version guard - exactly one winner under concurrency"
```

---

## Task 8: Gapless number ranges

**Files:** Create `packages/db/src/schema/numbering.ts`, `packages/platform/src/numbering.ts`, `packages/platform/src/numbering.int.test.ts`, migrations. Modify barrels/config, `migrate.ts` (version → 6).

- [x] **Step 1: Schema**

`packages/db/src/schema/numbering.ts`:
```ts
import { bigint, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mdSchema } from "./masterdata.js";
import { tenantIsolation } from "./rls.js";

/** Counter row per (tenant, range, period) — the short row lock on UPDATE serializes
 * allocation across ALL processes (also old+new binaries during a rollout: same row,
 * same lock — no gaps, no double allocations). Unpartitioned by design (spec §9.1). */
export const numberRanges = mdSchema.table(
  "number_ranges",
  {
    tenantId: uuid("tenant_id").notNull(),
    rangeKey: text("range_key").notNull(),
    period: text("period").notNull().default(""),
    currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
    prefix: text("prefix").notNull().default(""),
    padTo: integer("pad_to").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.rangeKey, t.period] }), tenantIsolation("number_ranges_tenant_isolation")],
);

/** In-tx allocation journal: the uniqueness constraint is the DB-level double-allocation
 * tripwire; detectGaps scans it for holes (gaps are DETECTED and explainable, not
 * prevented — a crash after allocate rolls the journal row back too). */
export const numberAllocations = mdSchema.table(
  "number_allocations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    rangeKey: text("range_key").notNull(),
    period: text("period").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    docRef: text("doc_ref"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("number_alloc_uq").on(t.tenantId, t.rangeKey, t.period, t.value),
    tenantIsolation("number_allocations_tenant_isolation"),
  ],
);
```
Generate + review; custom migration ENABLE/FORCE both. Bump `EXPECTED_SCHEMA_VERSION = 6`.

- [x] **Step 2: Failing tests** (`numbering.int.test.ts`)

1. **sequential allocation + formatting:** `createRange({ rangeKey: "INV", period: "2026", prefix: "INV-2026-", padTo: 6 })` (audited); three `allocateNumber` calls → values 1,2,3; formatted `INV-2026-000001` …
2. **unknown range →** `NumberRangeNotFoundError`.
3. **PROPERTY — dense and duplicate-free under heavy concurrency:**
```ts
it("property: 100 concurrent allocations are dense and duplicate-free", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 40, max: 100 }), async (n) => {
      const rangeKey = `R${crypto.randomUUID().slice(0, 8)}`;
      await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        createRange(tx, { tenantId: t.tenantId, rangeKey, period: "", actor: null }),
      );
      const results = await inParallel(
        Array.from({ length: n }, (_, i) => () =>
          withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
            allocateNumber(tx, { tenantId: t.tenantId, rangeKey, period: "", docRef: `doc-${i}` }),
          ),
        ),
      );
      if (results.some((r) => r.status === "rejected")) return false;
      const values = results.map((r) => (r as PromiseFulfilledResult<{ value: number }>).value.value).sort((a, b) => a - b);
      const dense = values.every((v, i) => v === i + 1);
      const gaps = await withTenantTx(t.handle.db, { tenantId: t.tenantId }, (tx) =>
        detectGaps(tx, { tenantId: t.tenantId, rangeKey, period: "" }),
      );
      return dense && values.length === n && gaps.length === 0;
    }),
    { numRuns: 10 },
  );
});
```
4. **per-(range, period) isolation:** concurrent allocations on two ranges/periods don't block or corrupt each other (each dense on its own).
5. **rollback leaves a DETECTED gap:** allocate inside a tx that then throws → `current_value` advanced? **No** — the counter update rolls back too, so no gap. The REAL crash-gap scenario is allocation committed but the *document insert* in a LATER separate tx failing — simulate: allocate in its own committed tx with `docRef: null` marking "document never materialized"… simplest honest test: allocate+commit, then delete the journal row as superuser (simulating a lost document), → `detectGaps` reports the hole. This documents what detection means.
6. **RLS probes** on both tables.
Run → FAIL.

- [x] **Step 3: Implement `packages/platform/src/numbering.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { newId } from "@erp/kernel";
import { type Tx, schema } from "@erp/db";
import { appendAudit } from "./audit.js";
import { NumberRangeNotFoundError } from "./errors.js";

export interface RangeDef { tenantId: string; rangeKey: string; period?: string; prefix?: string; padTo?: number; actor: string | null; }
// (No `gapless` flag column: every Phase-2 range is treated gapless; a merely-unique
// series mode arrives with its first consumer. The legal distinction lives in D-025.)

export async function createRange(tx: Tx, def: RangeDef): Promise<void> {
  await tx.insert(schema.numberRanges).values({
    tenantId: def.tenantId, rangeKey: def.rangeKey, period: def.period ?? "",
    prefix: def.prefix ?? "", padTo: def.padTo ?? 0,
  });
  await appendAudit(tx, {
    tenantId: def.tenantId, aggregateType: "NumberRange", aggregateId: `${def.rangeKey}:${def.period ?? ""}`,
    action: "numbering.create-range", actor: def.actor, payload: { ...def, actor: undefined },
  });
}

export interface AllocateInput { tenantId: string; rangeKey: string; period?: string; docRef?: string | null; }

/**
 * Allocate the next number under the counter row's lock. CONVENTION (spec §6): call this
 * as LATE as possible in the business transaction — the lock is held until commit, and a
 * later rollback is what turns an allocation into a gap.
 */
export async function allocateNumber(tx: Tx, input: AllocateInput): Promise<{ value: number; formatted: string }> {
  const period = input.period ?? "";
  const rows = await tx
    .update(schema.numberRanges)
    .set({ currentValue: sql`${schema.numberRanges.currentValue} + 1` })
    .where(and(
      eq(schema.numberRanges.tenantId, input.tenantId),
      eq(schema.numberRanges.rangeKey, input.rangeKey),
      eq(schema.numberRanges.period, period),
    ))
    .returning({ value: schema.numberRanges.currentValue, prefix: schema.numberRanges.prefix, padTo: schema.numberRanges.padTo });
  const row = rows[0];
  if (!row) throw new NumberRangeNotFoundError(input.rangeKey, period);
  await tx.insert(schema.numberAllocations).values({
    id: newId(), tenantId: input.tenantId, rangeKey: input.rangeKey, period,
    value: row.value, docRef: input.docRef ?? null,
  });
  const digits = String(row.value);
  return { value: row.value, formatted: `${row.prefix}${row.padTo > 0 ? digits.padStart(row.padTo, "0") : digits}` };
}

/** Holes between 1 and current_value with no journal row — every one must be explainable. */
export async function detectGaps(tx: Tx, ref: { tenantId: string; rangeKey: string; period?: string }): Promise<number[]> {
  const period = ref.period ?? "";
  const res = await tx.execute(sql`
    SELECT gs.v FROM md.number_ranges r
    CROSS JOIN LATERAL generate_series(1, r.current_value) AS gs(v)
    LEFT JOIN md.number_allocations a
      ON a.tenant_id = r.tenant_id AND a.range_key = r.range_key AND a.period = r.period AND a.value = gs.v
    WHERE r.tenant_id = ${ref.tenantId} AND r.range_key = ${ref.rangeKey} AND r.period = ${period} AND a.id IS NULL
    ORDER BY gs.v
  `);
  return (res.rows as Array<{ v: number | string }>).map((r) => Number(r.v));
}
```
> SAP-connected numbering (consume from SAP / provisional-id→adopt, spec §6/§9.3) is a Phase-5 concern; this local allocator is the `standalone` implementation behind the same call shape — do NOT abstract it prematurely (YAGNI), just keep the function signature payload-compatible.

- [x] **Step 4: Run to green** — `pnpm -r build && pnpm --filter @erp/platform test:int` → PASS.

- [x] **Step 5: Commit**

```bash
git add packages/db packages/platform
git commit -m "feat(platform): gapless number ranges - dense and duplicate-free under load"
```

---

## Task 9: Fiscal calendar + period-close posting gate

**Files:** Create `packages/db/src/schema/fiscal.ts`, `packages/platform/src/fiscal.ts`, `packages/platform/src/fiscal.int.test.ts`, `packages/contracts/src/events/fiscal.ts`, migrations. Modify `packages/platform/src/stock.ts` (+ test) to wire the gate, barrels/config/registry, `migrate.ts` (version → 7).

- [x] **Step 1: Schema**

`packages/db/src/schema/fiscal.ts`:
```ts
import { sql } from "drizzle-orm";
import { check, date, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantIsolation } from "./rls.js";

export const finSchema = pgSchema("fin");

/** Periods gate postings by POSTING date (document date is carried by documents, not here).
 * Dates are calendar dates (no timezone) — UTC storage/display conversion is a UI concern. */
export const fiscalPeriods = finSchema.table(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    year: integer("year").notNull(),
    period: integer("period").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"), // 'open' | 'closed'
    version: integer("version").notNull().default(1),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
  },
  (t) => [
    uniqueIndex("fiscal_period_uq").on(t.tenantId, t.year, t.period),
    check("fiscal_period_range", sql`period BETWEEN 1 AND 12`),
    check("fiscal_period_dates", sql`starts_on <= ends_on`),
    check("fiscal_period_status", sql`status IN ('open','closed')`),
    tenantIsolation("fiscal_periods_tenant_isolation"),
  ],
);
```
Generate + review; custom migration `--custom --name=fiscal-rls-overlap`:
```sql
ALTER TABLE "fin"."fiscal_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin"."fiscal_periods" FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA "fin" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "fin" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "fin" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";

-- No overlapping periods per tenant (btree_gist enables the mixed =/&& exclusion).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "fin"."fiscal_periods" ADD CONSTRAINT fiscal_periods_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&);
```
Bump `EXPECTED_SCHEMA_VERSION = 7`.

- [x] **Step 2: Event contracts** — `packages/contracts/src/events/fiscal.ts`: `FiscalPeriodClosedV1 = z.object({ periodId: z.uuid(), year: z.int(), period: z.int() })`, `FiscalPeriodReopenedV1` same shape; register both in `events/registry.ts`; barrel + unit test.

- [x] **Step 3: Failing tests** (`fiscal.int.test.ts`)

1. **create + gate happy path:** create 2026 periods 1–12 (helper building month boundaries); `assertPeriodOpen(tx, tenantId, "2026-07-15")` resolves.
2. **closed period blocks:** `closePeriod` period 7 (audited + `FiscalPeriodClosed` outbox event asserted) → `assertPeriodOpen(…, "2026-07-15")` throws `PeriodClosedError`.
3. **missing period fails closed:** `assertPeriodOpen(…, "2031-01-01")` throws `PeriodNotOpenError`.
4. **boundary dates:** `startsOn` and `endsOn` themselves are IN the period (inclusive `[]`).
5. **overlap rejected:** inserting an overlapping period → DB exclusion-constraint error.
6. **concurrent close — one winner:** two `closePeriod` with the same `expectedVersion` → exactly one succeeds, one `VersionConflictError` (reuses the Task-7 pattern); `reopenPeriod` restores and is audited + evented.
7. **the gate is WIRED:** `adjustOnHand(…, postingDate: "2026-07-15")` succeeds on the open period and **throws `PeriodClosedError` after closing it** — the first real consumer of the gate.
8. **RLS probes.**
Run → FAIL.

- [x] **Step 4: Implement `packages/platform/src/fiscal.ts`** (same shape as previous domains) *(reopen-of-open → new `FiscalPeriodNotClosedError`; error classes Fiscal-qualified per review)*

- `createPeriod(tx, { tenantId, year, period, startsOn, endsOn, actor })` → insert + audit (`fiscal.create-period`).
- `closePeriod(tx, { tenantId, periodId, expectedVersion, actor })` → guarded UPDATE `status: 'open' → 'closed'` + `version + 1` + `closedAt/closedBy`, `WHERE id AND version = expected AND status = 'open'`; 0 rows → re-select → missing → `PeriodNotFoundError`, version mismatch → `VersionConflictError`, already closed → `PeriodClosedError`; then audit + `FiscalPeriodClosed` event. `reopenPeriod` mirrors it.
- `assertPeriodOpen(tx, tenantId, postingDate)` → `SELECT status FROM fin.fiscal_periods WHERE tenant_id = ctx AND ${postingDate} BETWEEN starts_on AND ends_on` → none → `PeriodNotOpenError(postingDate)`; `status = 'closed'` → `PeriodClosedError(postingDate)`.
- Wire the gate: `adjustOnHand` (which has carried `postingDate` since Task 6) now calls `assertPeriodOpen` first; update the Task-6/7 int tests to create open periods covering their posting dates in `beforeAll`. Reservation does NOT take the gate (a reservation is not a posting).
- New errors: `PeriodNotFoundError`, `PeriodNotOpenError`, `PeriodClosedError`.

- [x] **Step 5: Run to green** — `pnpm -r build && pnpm --filter @erp/platform test:int` (all suites) + `pnpm --filter @erp/contracts test` → PASS.

- [x] **Step 6: Commit**

```bash
git add packages/db packages/platform packages/contracts
git commit -m "feat(platform): fiscal calendar + period-close posting gate"
```

---

## Task 10: Seeds, full verification sweep, journal, PR

**Files:** Create `packages/db/src/seed.ts`, `packages/db/src/seed.int.test.ts`. Modify `packages/db/src/index.ts`, this plan, `journal/PROGRESS.md`, `journal/DECISIONS.md`.

- [x] **Step 1: Deterministic seed (failing test first)** *(+ review additions: never-clobber regression test — live current_value/closed-period/on_hand survive a re-run; docblock + UUID block registry)*

`seed.int.test.ts`: `seedBaseline(db)` on a migrated DB → creates the fixed DEV tenant (`00000000-0000-7000-8000-000000000001`), 3 materials (`KITE-12M`, `BAR-55`, `BOARD-136`), stock items (on-hand 100 each), ranges `SO`/`INV` (period `"2026"`, prefixes `SO-2026-`/`INV-2026-`, padTo 6), fiscal periods 2026/1–12 open. **Run it twice → identical state (idempotent upserts), no duplicate-key errors.** Implement `seed.ts` with `onConflictDoNothing()` inserts as the superuser/bootstrap path (deliberate RLS bypass, same as tenant bootstrap); fixed UUIDs so tests/demos are stable. Export `seedBaseline` from the db barrel.
Run: `pnpm --filter @erp/db test:int` → PASS.

- [x] **Step 2: Full local verification sweep — the exact CI matrix, plus boundary + worker lanes** *(all green 2026-07-21; compose path documented: /ready 503 on unmigrated → runMigrations+seedBaseline via script → /ready 200)*

Run (each must be green; paste outputs into the session log):
```bash
pnpm install --frozen-lockfile
pnpm build         # FIRST — workspace deps resolve via dist (matches the CI order from Task 1)
pnpm typecheck
pnpm lint
pnpm boundaries
pnpm test          # unit: kernel, contracts, api, worker(env), platform(stable-stringify)
pnpm -r test:int   # integration: db (migrate+rls+seed), platform (audit/outbox/stock/numbering/fiscal), api (/ready), worker (boot+relay)
```
Also boot the dev stack once against compose (`docker compose up -d`): run migrations against it (small script or `tsx`-invoked `runMigrations` — or simply trust the Testcontainers evidence and verify `/ready` returns 503 *before* migrations and 200 *after*; document which was done).

- [x] **Step 3: Update plan + journal**

- This plan: tick every task checkbox, set Status → ✅ complete (pending PR).
- `journal/PROGRESS.md`: append the phase-02 entry (what shipped · suite counts · next: Phase 3 platform kernel).
- `journal/DECISIONS.md`: append (renumber to the next free D-NNN at execution):
  - **D-019** Phase-2 scope = spine + full §6; **auth + saga deferred to Phase 3** (deliberate §10.2 deviation; RLS context fed by synthetic principals until Keycloak); the §8 idempotency-key table defers with the first pg-boss consumer handlers.
  - **D-020** apps ship **all-ESM** (or: the require(esm) fallback shipped — record what actually happened in Task 1).
  - **D-021** fast-check + pool-parallel runner is the concurrency property harness; Stryker deferred.
  - **D-022** PG schemas named by eventual owner (`platform`/`md`/`wh`/`fin`); RLS = policies TO public + ENABLE+FORCE + `SET LOCAL ROLE app_rw` in `withTenantTx`; superuser is the deliberate bootstrap/relay bypass.
  - **D-023** audit chains serialize via row-locked `audit_head`; log stores payload hashes only (PII-free).
  - **D-024** outbox relay = interval loop in `apps/worker` (pg-boss cron floor is 1 min), at-least-once with `singletonKey` best-effort dedupe; consumer idempotency is the guarantee.
  - **D-025** gapless ranges: gaps detected (`detectGaps` + journal uniqueness) and explainable, not prevented; allocate-late convention documented.

- [x] **Step 4: Commit, push**

```bash
git add packages/db plans/phase-02-correctness-core.md journal/
git commit -m "chore: phase-02 seeds, verification sweep, journal updates"
git push -u origin phase-02-correctness-core
```

- [ ] **Step 5: PR (user action)** — open the PR in the browser: `https://github.com/Abishek-Ravikumar-08/Kitesurf_ERP/compare/main...phase-02-correctness-core?expand=1` — confirm CI green on the `pull_request` trigger, then merge (squash recommended).

---

## Verification (Definition of Done for Phase 2)

- [x] **ESM resolved:** api (and worker) build + boot + test green with the shipped module strategy; D-020 recorded
- [x] `GET /ready` → 200 on a migrated DB; **503** on schema mismatch AND on DB-down (fail-closed)
- [x] **RLS fail-closed proven on a real Postgres:** context-less → 0 rows; empty-string context → 0 rows (no cast error); cross-tenant → invisible; context-less write → rejected; no context leak across pooled transactions; ENABLE+FORCE catalog-asserted (`relrowsecurity AND relforcerowsecurity`) on every tenant table across `platform`/`md`/`wh`/`fin`
- [x] **Audit:** hash chain verifies; concurrent appends stay dense + valid; UPDATE/DELETE/TRUNCATE blocked (owner included); tamper detected by `verifyAuditChain`; log is payload-hash-only
- [x] **Outbox:** business write + audit + event commit in ONE tx; rollback leaves nothing; relay archives + fans out + marks; re-run is a no-op; at-least-once semantics documented + tested; worker boots with the schema gate and drains
- [x] **Reservation/ATP property-tested under real concurrency:** never negative (unless `allow_negative`), `reserved` == active-ledger sum == sum of successful reserves; oversell → typed error, nothing written
- [x] **Optimistic locking:** exactly-one-winner property + converging retry loop green
- [x] **Number ranges:** 100 concurrent allocations dense + duplicate-free; journal uniqueness enforced; `detectGaps` explains holes; allocate-late convention documented
- [x] **Fiscal:** closed/missing period blocks `adjustOnHand` (gate wired); overlap excluded; concurrent close has one winner *(+ gate takes FOR SHARE — close/post race closed, lock-semantics test added)*
- [x] **Every migration** reviewed + checked in; `EXPECTED_SCHEMA_VERSION = 7`; boot gate green in api AND worker
- [x] **Boundaries:** `pnpm boundaries` exit 0 AND the cross-package edge is verifiably resolved (Task 2 Step 7)
- [x] **Both toggles untouched-green:** no SAP/AI surface added; standalone + local defaults unaffected
- [x] Full local sweep green (Task 10 Step 2 = the CI matrix) — *CI-on-PR runs when the user opens the PR (pending)*
- [x] Plan checkboxes + `journal/PROGRESS.md` + `journal/DECISIONS.md` (D-019…D-025) updated — *PR opened by the user (pending)*

## Risks / open questions

- **NestJS 11 under ESM** is the phase's biggest unknown (Nest docs themselves flag ESM as partial). Mitigated: Task 1 is a hard gate with a concrete, tested fallback (api stays CJS + Node 24 `require(esm)`, TS ≥ 5.8). The fallback changes NOTHING in the packages.
- **Drizzle 0.45.2 RLS surface:** `pgPolicy`-in-table + `pgRole` + `entities.roles` verified against current docs, but 0.45.2 predates the newest docs cut — if `generate` doesn't emit policies/roles as expected, move them into the custom migrations (plain SQL) without changing the schema design. Same for the partial index `.where` form.
- **`ON CONFLICT … DO UPDATE SET x = alias.x RETURNING`** (audit head lock) uses the `INSERT … AS h` alias form — verify the generated statement against PG18 in the first audit test; if drizzle's `execute` chokes on it, it's plain SQL via `tx.execute` already, so only syntax can bite.
- **pg-boss 12 API drift:** v10+ semantics (explicit `createQueue`, array-receiving `work` handlers, `send` returning `null` on singleton suppression) verified via Context7; re-verify on the installed patch. The relay depends only on the structural `PgBossLike.send`.
- **Property-test wall clock:** budgeted via `numRuns` (10–25 int-lane) and one container per suite. If `pnpm -r test:int` exceeds ~10 min in CI, cut `numRuns` before cutting properties; never delete the invariants.
- **`SET LOCAL ROLE app_rw` requires membership** for non-superusers: prod connection roles must be granted `app_rw` (Day-0/provisioning concern, Phase 3); dev/tests connect as superuser where `SET ROLE` is unrestricted. The **worker/relay + chain-verify connection must additionally be superuser or `BYPASSRLS`** — under FORCE RLS, a merely-table-owner prod role would silently see 0 rows (empty drains, blind chain verification). Both requirements go in the provisioning runbook when it lands.
- **fast-check major:** pinned `^4.0.0` — confirm the latest 4.x and the `fc.jsonValue()` arbitrary name on the installed version at execution.

## Progress log

- 2026-07-18: Plan written after user-approved brainstorm (scope: spine + full §6, auth/saga → Phase 3; all-ESM; fast-check). Context7-verified Drizzle RLS/pgSchema, pg-boss 12, fast-check 4, NestJS SWC/ESM caveat. Not yet started — awaiting plan review + user approval.
- 2026-07-20: Plan-review loop complete — 3 iterations: iter 1 found 6 must-fix (build-vs-dist ordering, wiped-audit-chain hole, worker circular import, falsifiable stock property, postingDate ordering, missing reflect-metadata setup) + 11 advisories; iter 2 confirmed fixes, found 2 must-fix (relay boot-failure pool leak, vacuous depcruise resolution check) + 7 advisories; iter 3 **APPROVED** with 7 minor advisories, all folded in. Awaiting user sign-off — no implementation yet.
- 2026-07-21: **Executed Tasks 0–10** via subagent-driven development (fresh implementer per task; two-stage review — spec compliance then code quality — between tasks; strict TDD). 18 commits on `phase-02-correctness-core`. ESM hard gate passed first try (D-020, fallback unused). Reviews forced 6 hardening fix commits (RLS blocklist assertion, repeatable-read chain verify + uuid normalization, relay poison-row/connection docs, typed quantity validation, numbering docs, period-gate FOR SHARE + seed never-clobber test). Full CI-matrix sweep green locally; compose /ready 503→migrate(v7)+seed→200 documented. D-019–D-025 appended; branch pushed; PR left for the user.

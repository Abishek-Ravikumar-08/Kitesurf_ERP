# Phase 1 — Repo & Platform Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo foundation for the AI-native ERP — a booting NestJS API with typed config, a shared `@erp/kernel` (Money/UoM/IDs/DomainEvent), Drizzle migrations gated by a schema-version check against a real Postgres, enforced module boundaries, and green CI — so every later phase plugs into a working, tested base.

**Architecture:** A pnpm-workspace monorepo. TypeScript packages (`@erp/kernel`, `@erp/contracts`, `@erp/db`) + one app (`apps/api`, a NestJS modulith). PostgreSQL 18 via Docker Compose for dev and Testcontainers for integration tests. Everything is test-first (Vitest unit + integration; supertest for HTTP). No business modules yet — this is the skeleton they attach to.

**Tech Stack:** pnpm 10 (workspaces + catalog) · TypeScript · NestJS 11 · Drizzle ORM 0.45 + drizzle-kit 0.31 · PostgreSQL 18 (+ pgvector image) · Zod 4 · decimal.js · Vitest + Testcontainers · Biome + dependency-cruiser + Husky · GitHub Actions.

- **Implements:** spec §1, §2.1, §4, §7 (tenancy/config seams), §8 (event envelope, config/flags) — [2026-07-16-erp-ai-native-system-design.md](../docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md)
- **Status:** 🚧 in progress — Tasks 0–7 complete on `phase-01-skeleton`; Tasks 8–10 remaining
- **Created:** 2026-07-16 · **Last updated:** 2026-07-16
- **Depends on:** — (greenfield; git already initialized on `main`, remote → GitHub `Kitesurf_ERP`)

---

## Scope

- **In:** monorepo tooling; `@erp/kernel` (branded IDs, Money, Quantity/UoM, DomainEvent); `@erp/contracts` (Zod → OpenAPI generation); `@erp/db` (Drizzle config, first migration, programmatic migrate + **schema-version boot gate**); `apps/api` (bootstrap, Zod-validated typed config with fail-fast, `/health` + `/ready`); Docker Compose dev Postgres; dependency-cruiser boundaries + Husky/lint-staged; CI (typecheck, lint, unit, integration on Testcontainers, build).
- **Out (deferred):** correctness core → **Phase 2**; platform-kernel services (audit, approvals, MDM, files, notifications, printing, Day-0 provisioning) → **Phase 3+**; auth/Keycloak, AI plane, SAP engine, Python ML sidecars, frontend, appliance-agent → their own later phases. Caddy/Keycloak/MinIO containers are added when their phase needs them (Compose ships only Postgres now).

## Conventions for every task
- **TDD:** write the failing test → run it (see it fail) → minimal implementation → run it (pass) → commit. One logical change per commit; conventional-commit messages.
- **Context7 before library code:** re-verify the exact API/version of any library a step touches (Drizzle, NestJS, Zod, Testcontainers) via the Context7 MCP, then pin in the pnpm catalog. The versions below were verified 2026-07-16 but **confirm at execution**.
- **Branch:** work on a `phase-01-skeleton` branch off `main`; open a PR at the end (don't commit straight to `main`).
- **Definition of Done** for the phase: see the checklist at the bottom; each task also lists its own acceptance.

---

## File structure (created in this phase)

```
package.json                      # root: scripts, devDeps, packageManager
pnpm-workspace.yaml               # workspaces + version catalog (single source of pins)
tsconfig.base.json                # shared strict TS config
biome.json                        # format + lint (+ typescript-eslint later for type-aware rules)
.gitattributes .editorconfig .env.example .nvmrc
.dependency-cruiser.cjs           # module-boundary rules
docker-compose.yml                # dev Postgres 18 + pgvector
.github/workflows/ci.yml          # typecheck · lint · unit · integration · build
.husky/pre-commit                 # lint-staged + dependency-cruiser

packages/kernel/                  # @erp/kernel — pure, dependency-light domain primitives
  package.json tsconfig.json vitest.config.ts
  src/index.ts
  src/id.ts                       # branded IDs + newId() (UUIDv7)
  src/money.ts                    # Money value object (decimal.js), allocate/round
  src/quantity.ts                 # Quantity + UoM conversion registry
  src/domain-event.ts             # DomainEvent envelope + createEvent()
  src/*.test.ts

packages/contracts/               # @erp/contracts — Zod schemas → OpenAPI
  package.json tsconfig.json vitest.config.ts
  src/index.ts
  src/openapi.ts                  # buildOpenApiDocument(schemas)
  src/openapi.test.ts

packages/db/                      # @erp/db — Drizzle client, schema, migrations, boot gate
  package.json tsconfig.json vitest.config.ts drizzle.config.ts
  src/client.ts                   # drizzle(pool)
  src/schema/index.ts
  src/schema/platform.ts          # platform_meta(schema_version)
  src/migrate.ts                  # runMigrations() + assertSchemaVersion()
  drizzle/                        # generated SQL migrations (checked in)
  src/migrate.int.test.ts         # Testcontainers Postgres

apps/api/                         # NestJS modulith (only health + config for now)
  package.json tsconfig.json nest-cli.json vitest.config.ts
  src/main.ts
  src/app.module.ts
  src/config/env.ts               # Zod env schema + loadConfig() (fail-fast)
  src/config/config.module.ts     # provides validated config
  src/health/health.controller.ts # GET /health, GET /ready
  src/health/health.module.ts
  src/config/env.test.ts
  src/health/health.e2e.test.ts
```

---

## Task 0: Branch + repo hygiene

**Files:** Create `.gitattributes`, `.editorconfig`, `.nvmrc`, `.env.example`.

- [x] **Step 1: Create the branch**

Run:
```bash
git checkout -b phase-01-skeleton
```

- [x] **Step 2: Add `.gitattributes`** (normalize line endings — silences the CRLF warnings)

`.gitattributes`:
```
* text=auto eol=lf
*.png binary
*.jpg binary
*.webp binary
*.glb binary
```

- [x] **Step 3: Add `.editorconfig`, `.nvmrc`, `.env.example`**

`.editorconfig`:
```ini
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```
`.nvmrc`:
```
24
```
`.env.example`:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://erp:erp@localhost:5432/erp
INTEGRATION_MODE=standalone
DATA_EGRESS=deny
```

- [x] **Step 4: Commit**
```bash
git add .gitattributes .editorconfig .nvmrc .env.example
git commit -m "chore: repo hygiene (gitattributes, editorconfig, nvmrc, env example)"
```

---

## Task 1: Monorepo tooling (pnpm workspace + catalog + tsconfig + Biome)

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`.

- [x] **Step 1: `pnpm-workspace.yaml`** — workspaces + the version **catalog** (single source of pinned versions; **re-verify each via Context7 at execution**)

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  # runtime
  "@nestjs/common": 11.1.28
  "@nestjs/core": 11.1.28
  "@nestjs/platform-express": 11.1.28
  "@nestjs/testing": 11.1.28
  "reflect-metadata": ^0.2.2
  "rxjs": ^7.8.1
  drizzle-orm: 0.45.2
  pg: ^8.13.1
  zod: ^4.4.3
  decimal.js: ^10.4.3
  uuid: ^11.0.0
  # tooling / dev
  drizzle-kit: 0.31.5
  typescript: ^5.7.0
  vitest: ^2.1.0
  "@testcontainers/postgresql": ^10.13.0
  supertest: ^7.0.0
  "unplugin-swc": ^1.5.1
  "@swc/core": ^1.10.0
  "@biomejs/biome": ^1.9.4
  dependency-cruiser: ^16.9.0
  husky: ^9.1.0
  "lint-staged": ^15.2.0
```

- [x] **Step 2: root `package.json`**

```json
{
  "name": "kitesurf-erp",
  "private": true,
  "packageManager": "pnpm@10.13.1",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "pnpm -r test",
    "test:int": "pnpm -r test:int",
    "boundaries": "depcruise --config .dependency-cruiser.cjs packages apps",
    "dev": "pnpm --filter @erp/api start:dev",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "dependency-cruiser": "catalog:",
    "husky": "catalog:",
    "lint-staged": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [x] **Step 3: `tsconfig.base.json`** (strict)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [x] **Step 4: `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "files": { "ignore": ["**/dist/**", "**/drizzle/**", "**/coverage/**"] }
}
```

- [x] **Step 5: Install & verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; `pnpm-lock.yaml` created.

- [x] **Step 6: Commit**
```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json
git commit -m "chore: pnpm workspace, version catalog, tsconfig, biome"
```

---

## Task 2: `@erp/kernel` — branded IDs + DomainEvent envelope

**Files:** Create `packages/kernel/{package.json,tsconfig.json,vitest.config.ts}`, `packages/kernel/src/{index.ts,id.ts,domain-event.ts}`, `packages/kernel/src/{id.test.ts,domain-event.test.ts}`.

- [x] **Step 1: Package scaffolding**

`packages/kernel/package.json`:
```json
{
  "name": "@erp/kernel",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": { "decimal.js": "catalog:", "uuid": "catalog:" },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```
`packages/kernel/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src/**/*"] }
```
`packages/kernel/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [x] **Step 2: Write the failing test for branded IDs**

`packages/kernel/src/id.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { newId, type TenantId, asTenantId } from "./id.js";

describe("id", () => {
  it("newId returns a v7 uuid string", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("branding is a compile-time-only wrapper (runtime is the string)", () => {
    const t: TenantId = asTenantId(newId());
    expect(typeof t).toBe("string");
  });
});
```

- [x] **Step 3: Run it, see it fail**

Run: `pnpm --filter @erp/kernel test`
Expected: FAIL (`./id.js` not found).

- [x] **Step 4: Implement `src/id.ts`**

```ts
import { v7 as uuidv7 } from "uuid";

/** Opaque branded-id helper — compile-time safety, runtime is just a string. */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type EventId = Brand<string, "EventId">;

export const newId = (): string => uuidv7();
export const asTenantId = (s: string): TenantId => s as TenantId;
export const asUserId = (s: string): UserId => s as UserId;
export const asEventId = (s: string): EventId => s as EventId;
```

- [x] **Step 5: Run it, see it pass**

Run: `pnpm --filter @erp/kernel test`
Expected: PASS.

- [x] **Step 6: Write the failing test for the DomainEvent envelope**

`packages/kernel/src/domain-event.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createEvent } from "./domain-event.js";
import { asTenantId, asUserId, newId } from "./id.js";

describe("createEvent", () => {
  it("builds the canonical envelope with correlation defaults", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const e = createEvent({
      type: "SalesOrderConfirmed",
      eventVersion: 1,
      tenantId: asTenantId(newId()),
      actor: asUserId(newId()),
      payload: { orderId: "so-1" },
      occurredAt: now,
    });
    expect(e.eventId).toMatch(/-7[0-9a-f]{3}-/);
    expect(e.type).toBe("SalesOrderConfirmed");
    expect(e.eventVersion).toBe(1);
    expect(e.occurredAt).toBe(now.toISOString());
    // correlationId defaults to eventId; causationId defaults to undefined
    expect(e.correlationId).toBe(e.eventId);
    expect(e.causationId).toBeUndefined();
    expect(e.payload).toEqual({ orderId: "so-1" });
  });
});
```

- [x] **Step 7: Run it, see it fail** — Run: `pnpm --filter @erp/kernel test` → FAIL.

- [x] **Step 8: Implement `src/domain-event.ts`**

```ts
import { asEventId, type EventId, newId, type TenantId, type UserId } from "./id.js";

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: EventId;
  type: TType;
  eventVersion: number;
  occurredAt: string; // ISO-8601
  tenantId: TenantId;
  actor: UserId | null;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}

export interface CreateEventInput<TType extends string, TPayload> {
  type: TType;
  eventVersion: number;
  tenantId: TenantId;
  actor: UserId | null;
  payload: TPayload;
  occurredAt: Date; // caller supplies the clock (testable/deterministic)
  correlationId?: string;
  causationId?: string;
}

export function createEvent<TType extends string, TPayload>(
  input: CreateEventInput<TType, TPayload>,
): DomainEvent<TType, TPayload> {
  const eventId = asEventId(newId());
  return {
    eventId,
    type: input.type,
    eventVersion: input.eventVersion,
    occurredAt: input.occurredAt.toISOString(),
    tenantId: input.tenantId,
    actor: input.actor,
    correlationId: input.correlationId ?? eventId,
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    payload: input.payload,
  };
}
```

- [x] **Step 9: Run it, see it pass** — Run: `pnpm --filter @erp/kernel test` → PASS.

- [x] **Step 10: Barrel + build check** — `packages/kernel/src/index.ts`:
```ts
export * from "./id.js";
export * from "./domain-event.js";
export * from "./money.js";
export * from "./quantity.js";
```
Run: `pnpm --filter @erp/kernel build` → Expected: PASS (no type errors). *(money/quantity are added next tasks; if building before them, temporarily export only id+domain-event, then re-add.)*

- [x] **Step 11: Commit**
```bash
git add packages/kernel
git commit -m "feat(kernel): branded ids and DomainEvent envelope"
```

---

## Task 3: `@erp/kernel` — Money value object (decimal, allocate)

**Files:** Create `packages/kernel/src/money.ts`, `packages/kernel/src/money.test.ts`.

- [x] **Step 1: Write the failing tests** (invariants + the penny-safe `allocate`)

`packages/kernel/src/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Money } from "./money.js";

describe("Money", () => {
  it("adds same-currency amounts and keeps a string decimal", () => {
    const sum = Money.of("10.10", "USD").add(Money.of("0.20", "USD"));
    expect(sum.toString()).toBe("10.30");
    expect(sum.currency).toBe("USD");
  });
  it("rejects cross-currency arithmetic", () => {
    expect(() => Money.of("1", "USD").add(Money.of("1", "EUR"))).toThrow(/currency/i);
  });
  it("allocate splits without losing or inventing minor units", () => {
    const parts = Money.of("10.00", "USD").allocate([1, 1, 1]); // 3-way
    expect(parts.map((p) => p.toString())).toEqual(["3.34", "3.33", "3.33"]);
    const total = parts.reduce((a, b) => a.add(b), Money.zero("USD"));
    expect(total.toString()).toBe("10.00");
  });
  it("multiply applies a factor with explicit rounding (half-up, 2dp)", () => {
    expect(Money.of("2.005", "USD").round(2).toString()).toBe("2.01");
  });
});
```

- [x] **Step 2: Run it, see it fail** — Run: `pnpm --filter @erp/kernel test` → FAIL.

- [x] **Step 3: Implement `src/money.ts`**

```ts
import Decimal from "decimal.js";

export type CurrencyCode = string; // ISO-4217; validated at the boundary, not here

export class Money {
  private constructor(
    private readonly amount: Decimal,
    public readonly currency: CurrencyCode,
  ) {}

  static of(amount: string | number, currency: CurrencyCode): Money {
    return new Money(new Decimal(amount), currency);
  }
  static zero(currency: CurrencyCode): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }
  multiply(factor: string | number): Money {
    return new Money(this.amount.times(new Decimal(factor)), this.currency);
  }
  /** Half-up rounding to `dp` decimal places. */
  round(dp: number): Money {
    return new Money(this.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), this.currency);
  }
  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount);
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }
  toString(): string {
    return this.amount.toFixed(2);
  }

  /** Largest-remainder allocation: distributes self across ratios losing zero minor units. */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) throw new Error("allocate requires at least one ratio");
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("allocate ratios must sum to a positive value");
    const cents = this.amount.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    let remainder = cents;
    const out: Decimal[] = [];
    for (const r of ratios) {
      const share = cents.times(r).dividedBy(total).toDecimalPlaces(0, Decimal.ROUND_DOWN);
      out.push(share);
      remainder = remainder.minus(share);
    }
    // hand back the leftover minor units, one at a time, to the first buckets
    for (let i = 0; remainder.greaterThan(0); i = (i + 1) % out.length) {
      out[i] = out[i]!.plus(1);
      remainder = remainder.minus(1);
    }
    return out.map((c) => new Money(c.dividedBy(100), this.currency));
  }
}
```

- [x] **Step 4: Run it, see it pass** — Run: `pnpm --filter @erp/kernel test` → PASS.

- [x] **Step 5: Commit**
```bash
git add packages/kernel/src/money.ts packages/kernel/src/money.test.ts
git commit -m "feat(kernel): Money value object with penny-safe allocate"
```

---

## Task 4: `@erp/kernel` — Quantity + UoM conversion

**Files:** Create `packages/kernel/src/quantity.ts`, `packages/kernel/src/quantity.test.ts`.

- [x] **Step 1: Write the failing tests** (conversion + round-trip invariant)

`packages/kernel/src/quantity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Quantity, UomRegistry } from "./quantity.js";

describe("UoM", () => {
  const reg = new UomRegistry([
    { dimension: "count", unit: "EA", toBase: 1 },
    { dimension: "count", unit: "BOX", toBase: 12 }, // 1 box = 12 each
    { dimension: "count", unit: "PAL", toBase: 144 }, // 1 pallet = 12 boxes
  ]);
  it("converts across units within a dimension", () => {
    expect(reg.convert(Quantity.of("2", "BOX"), "EA").toString()).toBe("24");
    expect(reg.convert(Quantity.of("288", "EA"), "PAL").toString()).toBe("2");
  });
  it("round-trips without drift", () => {
    const q = Quantity.of("7", "BOX");
    const back = reg.convert(reg.convert(q, "EA"), "BOX");
    expect(back.toString()).toBe("7");
  });
  it("rejects cross-dimension conversion", () => {
    const r2 = new UomRegistry([
      { dimension: "count", unit: "EA", toBase: 1 },
      { dimension: "mass", unit: "KG", toBase: 1 },
    ]);
    expect(() => r2.convert(Quantity.of("1", "EA"), "KG")).toThrow(/dimension/i);
  });
});
```

- [x] **Step 2: Run it, see it fail** — Run: `pnpm --filter @erp/kernel test` → FAIL.

- [x] **Step 3: Implement `src/quantity.ts`**

```ts
import Decimal from "decimal.js";

export class Quantity {
  private constructor(private readonly value: Decimal, public readonly unit: string) {}
  static of(value: string | number, unit: string): Quantity {
    return new Quantity(new Decimal(value), unit);
  }
  raw(): Decimal {
    return this.value;
  }
  toString(): string {
    return this.value.toString();
  }
}

export interface UomDef {
  dimension: string;
  unit: string;
  toBase: number | string; // factor to the dimension's base unit
}

export class UomRegistry {
  private readonly byUnit = new Map<string, UomDef>();
  constructor(defs: UomDef[]) {
    for (const d of defs) this.byUnit.set(d.unit, d);
  }
  convert(q: Quantity, toUnit: string): Quantity {
    const from = this.byUnit.get(q.unit);
    const to = this.byUnit.get(toUnit);
    if (!from) throw new Error(`unknown unit: ${q.unit}`);
    if (!to) throw new Error(`unknown unit: ${toUnit}`);
    if (from.dimension !== to.dimension) {
      throw new Error(`cannot convert across dimension: ${from.dimension} -> ${to.dimension}`);
    }
    const base = q.raw().times(new Decimal(from.toBase));
    return Quantity.of(base.dividedBy(new Decimal(to.toBase)).toString(), toUnit);
  }
}
```

- [x] **Step 4: Run it, see it pass** — Run: `pnpm --filter @erp/kernel test` → PASS. Then `pnpm --filter @erp/kernel build` → PASS.

- [x] **Step 5: Commit**
```bash
git add packages/kernel/src/quantity.ts packages/kernel/src/quantity.test.ts packages/kernel/src/index.ts
git commit -m "feat(kernel): Quantity and UoM conversion registry"
```

---

## Task 5: `@erp/contracts` — Zod → OpenAPI generation

**Files:** Create `packages/contracts/{package.json,tsconfig.json,vitest.config.ts}`, `packages/contracts/src/{index.ts,openapi.ts,openapi.test.ts}`.

- [x] **Step 1: Scaffolding** (mirror the kernel package.json; name `@erp/contracts`; deps: `zod: "catalog:"`).

- [x] **Step 2: Write the failing test** (Zod 4's first-party `z.toJSONSchema`)

`packages/contracts/src/openapi.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument } from "./openapi.js";

describe("buildOpenApiDocument", () => {
  it("emits component schemas from Zod schemas", () => {
    const HealthResponse = z.object({ status: z.literal("ok") });
    const doc = buildOpenApiDocument("Kitesurf ERP API", "0.1.0", { HealthResponse });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Kitesurf ERP API");
    expect(doc.components.schemas.HealthResponse).toMatchObject({
      type: "object",
      properties: { status: { const: "ok" } },
    });
  });
});
```

- [x] **Step 3: Run it, see it fail** — Run: `pnpm --filter @erp/contracts test` → FAIL.

- [x] **Step 4: Implement `src/openapi.ts`**

```ts
import { z } from "zod";

export function buildOpenApiDocument(
  title: string,
  version: string,
  schemas: Record<string, z.ZodType>,
) {
  const components: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    // Default target emits JSON Schema draft-2020-12 (aligns with OpenAPI 3.1, preserves `const`).
    components[name] = z.toJSONSchema(schema);
  }
  return {
    openapi: "3.1.0",
    info: { title, version },
    paths: {},
    components: { schemas: components },
  };
}
```
> `z.toJSONSchema(schema)` with no `target` emits draft-2020-12, which keeps `const` for `z.literal(...)` and matches the `openapi: "3.1.0"` document (OpenAPI 3.0's target would down-level `const` to `enum`, breaking the test). Context7-verify the exact signature on the pinned Zod 4 patch.

- [x] **Step 5: Run it, see it pass** — Run: `pnpm --filter @erp/contracts test` → PASS.

- [x] **Step 6: Barrel + commit**

`src/index.ts`: `export * from "./openapi.js";`
```bash
git add packages/contracts
git commit -m "feat(contracts): Zod -> OpenAPI document builder"
```

---

## Task 6: Docker Compose dev Postgres

**Files:** Create `docker-compose.yml`.

- [x] **Step 1: Add Compose (Postgres 18 + pgvector image)**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: erp
      POSTGRES_PASSWORD: erp
      POSTGRES_DB: erp
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U erp -d erp"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  pgdata:
```
> Verify the exact `pgvector/pgvector:pg18` tag exists at execution; else use `postgres:18` + add the pgvector extension in a later phase.

- [x] **Step 2: Bring it up and verify**

Run: `docker compose up -d && docker compose ps`
Expected: `postgres` healthy.

- [x] **Step 3: Commit**
```bash
git add docker-compose.yml
git commit -m "chore: dev Postgres 18 + pgvector via docker compose"
```

---

## Task 7: `@erp/db` — Drizzle schema, migration, and schema-version boot gate

**Files:** Create `packages/db/{package.json,tsconfig.json,vitest.config.ts,drizzle.config.ts}`, `packages/db/src/{client.ts,migrate.ts}`, `packages/db/src/schema/{index.ts,platform.ts}`, `packages/db/src/migrate.int.test.ts`, and the generated `packages/db/drizzle/*`.

- [x] **Step 1: Scaffolding**

`packages/db/package.json`:
```json
{
  "name": "@erp/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "db:generate": "drizzle-kit generate",
    "test:int": "vitest run --config vitest.config.ts"
  },
  "dependencies": { "drizzle-orm": "catalog:", "pg": "catalog:" },
  "devDependencies": {
    "drizzle-kit": "catalog:",
    "@testcontainers/postgresql": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`packages/db/vitest.config.ts` (integration tests only; longer timeout for containers):
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.int.test.ts"], testTimeout: 120_000, hookTimeout: 120_000 } });
```

- [x] **Step 2: Schema — `platform_meta` (holds the schema version)**

`packages/db/src/schema/platform.ts`:
```ts
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Single-row table recording the schema version the DB is migrated to.
export const platformMeta = pgTable("platform_meta", {
  id: integer("id").primaryKey().default(1),
  schemaVersion: integer("schema_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});
```
`packages/db/src/schema/index.ts`: `export * from "./platform.js";`

- [x] **Step 3: `drizzle.config.ts`** (current API: `defineConfig` + `dialect`)

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // `db:generate` needs no live DB; programmatic migrate() (src/migrate.ts) applies them.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```
> `dotenv` is intentionally not imported here (it isn't a dep of `@erp/db`); `db:generate` doesn't connect to a DB.

- [x] **Step 4: Generate the first migration**

Run: `pnpm --filter @erp/db db:generate`
Expected: a SQL file appears under `packages/db/drizzle/` creating `platform_meta`. **Commit it** (migrations are checked in).

- [x] **Step 5: `client.ts` + `migrate.ts` (runner + boot gate)**

`packages/db/src/client.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export function makeDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}
export type Db = ReturnType<typeof makeDb>["db"];
```
`packages/db/src/migrate.ts`:
```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Db } from "./client.js";
import { platformMeta } from "./schema/platform.js";

/** The version this code build expects the DB to be at. Bump when a migration ships. */
export const EXPECTED_SCHEMA_VERSION = 1;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
  // upsert the single meta row to the expected version
  await db
    .insert(platformMeta)
    .values({ id: 1, schemaVersion: EXPECTED_SCHEMA_VERSION })
    .onConflictDoUpdate({ target: platformMeta.id, set: { schemaVersion: EXPECTED_SCHEMA_VERSION } });
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
```
`packages/db/src/index.ts`: `export * from "./client.js"; export * from "./migrate.js"; export * as schema from "./schema/index.js";`

- [x] **Step 6: Write the failing integration test (Testcontainers real Postgres)**

`packages/db/src/migrate.int.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./client.js";
import { assertSchemaVersion, EXPECTED_SCHEMA_VERSION, runMigrations } from "./migrate.js";

describe("migrations + schema-version gate", () => {
  let container: StartedPostgreSqlContainer;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg18").start();
    const made = makeDb(container.getConnectionUri());
    db = made.db;
    close = async () => { await made.pool.end(); await container.stop(); };
  });
  afterAll(async () => { await close(); });

  it("applies migrations and records the expected schema version", async () => {
    await runMigrations(db);
    await expect(assertSchemaVersion(db)).resolves.toBeUndefined();
  });

  it("boot gate throws on a version mismatch", async () => {
    // Force a mismatch, then assert the gate refuses.
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`UPDATE platform_meta SET schema_version = ${EXPECTED_SCHEMA_VERSION + 99} WHERE id = 1`);
    await expect(assertSchemaVersion(db)).rejects.toThrow(/schema version mismatch/);
  });
});
```

- [x] **Step 7: Run it, see it fail** — Run: `pnpm --filter @erp/db test:int` → FAIL first (before impl compiles) — ensure it then FAILs for the right reason, and that Docker is available for Testcontainers.

- [x] **Step 8: Iterate to green** — build/typecheck the package, fix imports, re-run.

Run: `pnpm --filter @erp/db test:int`
Expected: PASS (2 tests).

- [x] **Step 9: Commit**
```bash
git add packages/db
git commit -m "feat(db): drizzle client, platform_meta migration, and schema-version boot gate"
```

---

## Task 8: `apps/api` — NestJS bootstrap, Zod-validated config (fail-fast), health

**Files:** Create `apps/api/{package.json,tsconfig.json,nest-cli.json,vitest.config.ts}`, `apps/api/src/{main.ts,app.module.ts}`, `apps/api/src/config/{env.ts,config.module.ts,env.test.ts}`, `apps/api/src/health/{health.controller.ts,health.module.ts,health.e2e.test.ts}`.

- [ ] **Step 1: Scaffolding**

`apps/api/package.json`:
```json
{
  "name": "@erp/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "catalog:",
    "supertest": "catalog:",
    "unplugin-swc": "catalog:",
    "@swc/core": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
> `@erp/kernel`/`@erp/db` are intentionally **not** `apps/api` dependencies yet — the Phase-1 api (health + config only) imports none of them. They're added in Phase 2 together with the ESM/CJS decision (see Risks).

`apps/api/nest-cli.json`: `{ "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "builder": "swc" } }`
`apps/api/.swcrc` (emit decorator metadata for BOTH `nest build` and Vitest — required for Nest DI):
```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2023"
  }
}
```
`apps/api/tsconfig.json`: extends base; `outDir: dist`, `emitDecoratorMetadata: true` (already in base).
`apps/api/vitest.config.ts` (SWC so Nest decorators/DI work under Vitest):
```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], globals: true, testTimeout: 30_000 },
  plugins: [swc.vite()],
});
```

- [ ] **Step 2: Write the failing test for config validation (fail-fast)**

`apps/api/src/config/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("parses a valid environment", () => {
    const cfg = loadConfig({ NODE_ENV: "test", PORT: "3000", DATABASE_URL: "postgresql://x", INTEGRATION_MODE: "standalone", DATA_EGRESS: "deny" });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.INTEGRATION_MODE).toBe("standalone");
  });
  it("throws a descriptive error on invalid env", () => {
    expect(() => loadConfig({ NODE_ENV: "test", PORT: "not-a-number", DATABASE_URL: "", INTEGRATION_MODE: "banana", DATA_EGRESS: "deny" })).toThrow(/PORT|DATABASE_URL|INTEGRATION_MODE/);
  });
});
```

- [ ] **Step 3: Run it, see it fail** — Run: `pnpm --filter @erp/api test` → FAIL.

- [ ] **Step 4: Implement `src/config/env.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  INTEGRATION_MODE: z.enum(["standalone", "sap"]).default("standalone"),
  DATA_EGRESS: z.enum(["allow", "deny"]).default("deny"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
```

- [ ] **Step 5: Run it, see it pass** — Run: `pnpm --filter @erp/api test` → PASS.

- [ ] **Step 6: Config module + app module**

`apps/api/src/config/config.module.ts`:
```ts
import { Global, Module } from "@nestjs/common";
import { type AppConfig, loadConfig } from "./env.js";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```
`apps/api/src/app.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({ imports: [ConfigModule, HealthModule] })
export class AppModule {}
```

- [ ] **Step 7: Write the failing e2e test for `/health`**

`apps/api/src/health/health.e2e.test.ts`:
```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("health (e2e)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgresql://erp:erp@localhost:5432/erp";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("GET /health -> 200 {status:'ok'}", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 8: Run it, see it fail** — Run: `pnpm --filter @erp/api test` → FAIL.

- [ ] **Step 9: Implement health module + controller + `main.ts`**

`apps/api/src/health/health.controller.ts`:
```ts
import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
```
`apps/api/src/health/health.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

@Module({ controllers: [HealthController] })
export class HealthModule {}
```
`apps/api/src/main.ts`:
```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/env.js";

async function bootstrap() {
  const cfg = loadConfig(); // fail-fast at boot
  const app = await NestFactory.create(AppModule);
  await app.listen(cfg.PORT);
}
void bootstrap();
```

- [ ] **Step 10: Run it, see it pass** — Run: `pnpm --filter @erp/api test` → PASS.

- [ ] **Step 11: Manual smoke against dev Postgres**

Run: `docker compose up -d && pnpm --filter @erp/api build && node apps/api/dist/main.js`
Then: `curl -s localhost:3000/health` → Expected: `{"status":"ok"}`. Stop the process.

- [ ] **Step 12: Commit**
```bash
git add apps/api
git commit -m "feat(api): NestJS bootstrap, Zod-validated config (fail-fast), /health"
```

> **Follow-up (optional; otherwise the first task of Phase 2):** add `GET /ready` that runs `assertSchemaVersion(db)` + `SELECT 1` and returns 503 on failure — wire `@erp/db` `makeDb` as a provider using `APP_CONFIG.DATABASE_URL`. This is the point where `apps/api` first imports an `@erp/*` package, so it **requires resolving the ESM/CJS decision** (see Risks) and adding `@erp/db` to the api deps. Add an integration test using Testcontainers (mirrors Task 7). Separate commit.

---

## Task 9: Module-boundary enforcement (dependency-cruiser + Husky)

**Files:** Create `.dependency-cruiser.cjs`, `.husky/pre-commit`; modify root `package.json` (lint-staged config).

- [ ] **Step 1: Write the boundary rules**

`.dependency-cruiser.cjs`:
```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "no-cross-app-imports",
      severity: "error",
      comment: "apps must not import each other",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/(?!$1)([^/]+)/" },
    },
    {
      name: "domain-not-import-infra",
      severity: "error",
      comment: "domain/ must not import infra/",
      from: { path: "/domain/" },
      to: { path: "/infra/" },
    },
    {
      name: "no-cross-package-deep-import",
      severity: "error",
      comment: "import a package's public entry (@erp/x), never ANOTHER package's src internals",
      from: { path: "^packages/([^/]+)/" },
      to: {
        path: "^packages/[^/]+/src/",
        pathNot: ["^packages/$1/", "src/index\\.(ts|js)$", "\\.test\\.ts$"],
      },
    },
    {
      name: "no-app-deep-import",
      severity: "error",
      comment: "apps import a package's public entry, not its src internals",
      from: { path: "^apps/" },
      to: { path: "^packages/[^/]+/src/", pathNot: ["src/index\\.(ts|js)$", "\\.test\\.ts$"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
```
> Before Phase 2 introduces real cross-package `@erp/*` imports, confirm `tsConfig` (+ `enhancedResolveOptions` if needed) lets dependency-cruiser resolve `.js`→`.ts` specifiers and workspace package names — otherwise the deep-import rules stay exit 0 but under-enforced.
> `from.path` captures the package name as `$1`; `to.pathNot: "^packages/$1/"` lets a package import its OWN `src` (relative internal imports) while blocking deep imports into *other* packages' internals — `src/index` and `*.test.ts` are always allowed. In Phase 1 no package imports another `@erp/*`, so this stays clean (exit 0). Verify the capture-group reference resolves as expected (dist vs src) at execution.

- [ ] **Step 2: Verify boundaries pass on the current tree**

Run: `pnpm boundaries`
Expected: no violations (exit 0). Fix any real violation surfaced.

- [ ] **Step 3: Husky + lint-staged pre-commit**

Run: `pnpm exec husky init`
`.husky/pre-commit`:
```sh
pnpm lint-staged && pnpm boundaries
```
Add to root `package.json`:
```json
"lint-staged": { "*.{ts,tsx,js,json,md}": "biome check --write --no-errors-on-unmatched" }
```

- [ ] **Step 4: Commit**
```bash
git add .dependency-cruiser.cjs .husky package.json
git commit -m "chore: dependency-cruiser boundaries + husky pre-commit"
```

---

## Task 10: CI pipeline (GitHub Actions)

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1: Write the workflow** (Docker is available on `ubuntu-latest` for Testcontainers)

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: {}
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4          # TODO: pin to commit SHA before first release
      - uses: pnpm/action-setup@v4         # reads packageManager from package.json
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm boundaries
      - run: pnpm test                     # unit (kernel, contracts, api)
      - run: pnpm -r test:int              # integration (db) — Testcontainers uses host Docker
      - run: pnpm build
```

- [ ] **Step 2: Verify locally that each command the CI runs is green**

Run (in order): `pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test && pnpm -r test:int && pnpm build`
Expected: all green.

- [ ] **Step 3: Commit, push, open PR**
```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck, lint, boundaries, unit, integration, build"
git push -u origin phase-01-skeleton
```
Then open a PR to `main` (via the github MCP or `gh pr create`) and confirm CI is green.

- [ ] **Step 4: Update plan + journal**
- Set this plan's Status → ✅ and check off tasks.
- Append a `PROGRESS.md` entry (what shipped, CI green, next = Phase 2 correctness core).
- Add `D-013` to `DECISIONS.md` if any implementation decision diverged from the plan (e.g., Postgres image tag, Vitest/SWC setup).

---

## Verification (Definition of Done for Phase 1)
- [ ] `pnpm install` clean; workspace resolves; versions pinned in the catalog (Context7-verified)
- [ ] `@erp/kernel` unit tests green: Money (incl. `allocate` sums back), UoM round-trip, DomainEvent envelope
- [ ] `@erp/contracts` generates OpenAPI component schemas from Zod
- [ ] `@erp/db` **integration** test green on a **real Postgres (Testcontainers)**: migrations apply, schema-version gate passes, and **fails closed on mismatch**
- [ ] `apps/api` boots; config **fails fast** on bad env; `GET /health` → `{status:"ok"}` (e2e)
- [ ] `pnpm boundaries` passes; Husky pre-commit active
- [ ] CI green on the PR (typecheck · lint · boundaries · unit · integration · build)
- [ ] Plan status + `journal/PROGRESS.md` + `journal/DECISIONS.md` updated; PR opened to `main`

## Risks / open questions
- **ESM/CJS module strategy.** The shared packages are ESM (`type: module`); `apps/api` (NestJS) defaults to CommonJS. Phase-1's api (health + config) imports no `@erp/*` package, so this is inert now. **Before the api imports any `@erp/*` package** (the `/ready` follow-up / Phase 2), decide the strategy — recommended: **all-ESM** (set `apps/api` `type: module`, verify NestJS + SWC boot under ESM), or ship the shared packages **dual-format** (CJS+ESM). Importing an ESM-only package from CJS fails (TS1479 / `ERR_REQUIRE_ESM`).
- **Vitest + NestJS decorators** need SWC (`unplugin-swc`); if DI metadata misbehaves under Vitest, fall back to `@swc/jest`+Jest for `apps/api` only (keep Vitest elsewhere). Decide at Task 8.
- **`pgvector/pgvector:pg18` tag** must exist; otherwise `postgres:18` now and add pgvector in the DB-hardening phase.
- **Zod `z.toJSONSchema` options** — confirm the `target` option name/shape on the pinned patch.
- Everything here is **single-tenant, no-auth, no-RLS yet** — RLS/tenancy land in Phase 2/3; the `tenant_id`-everywhere rule starts when the first real domain table is created (correctness core).

## Progress log
- 2026-07-16: Plan written (Context7-verified Drizzle/Zod/NestJS APIs). Not yet started. Next: execute Task 0 on a `phase-01-skeleton` branch.
- 2026-07-17: Executed Tasks 0–7 via subagent-driven TDD on `phase-01-skeleton` (8 commits: hygiene → workspace → kernel → contracts → Compose → db). Review corrected `Money.allocate` (D-015) and hardened the db boot-gate test; deviations D-013–D-017 recorded. Next: Tasks 8–10 + PR to `main`.

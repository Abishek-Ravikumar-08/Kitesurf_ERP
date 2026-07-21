# Phase 3 — Trust + Decision Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every write gains a real principal and a decision path — Keycloak-backed BFF auth + CASL + the `ai_ro` cage, the ONE approval/workflow engine with savepoint execute semantics, the Postgres-backed saga engine bridged by an approval step type, the §8 idempotency-key primitive, and the first real pg-boss consumers (retiring D-024's relay-quarantine debt).

**Architecture:** New `@erp/auth` package (principals, sessions, CASL) consumed by `apps/api`'s BFF module; approval + saga engines join the Phase-2 domains in `@erp/platform` (functions over `Tx`, audit + outbox in the same transaction); all saga/approval async transitions ride the outbox → relay → `ConsumerRegistry` (never direct `boss.send`). Spec: **[2026-07-21-phase-03-trust-decision-spine-design.md](../docs/superpowers/specs/2026-07-21-phase-03-trust-decision-spine-design.md)** — read it before starting; its §2 scope decisions and §5/§6 semantics are settled.

**Tech Stack:** everything Phase 2 pinned, plus **openid-client ^6.8.4** (v6 functional API — verified 2026-07-21: `discovery`/`randomPKCECodeVerifier`/`calculatePKCECodeChallenge`/`buildAuthorizationUrl`/`authorizationCodeGrant`/`buildEndSessionUrl`), **@casl/ability ^7.0.1** (verified: `AbilityBuilder` + `createMongoAbility` + `ForbiddenError` carry over into v7), **cookie-parser ^1.4.7**, **Keycloak 26** (`quay.io/keycloak/keycloak:26.4` — image verified) via Testcontainers **`GenericContainer`** (no dedicated module exists) with `start-dev --import-realm`. Drizzle nested `tx.transaction()` = SAVEPOINT (verified) powers the execute-failure semantics.

- **Implements:** phase-03 spec §§3–8; parent spec §7 (approval engine, tranche), §8 (idempotency), §9.2 (saga), §9.4 (auth), §9.10 (negative suite)
- **Status:** ✅ approved (plan-review loop passed 2026-07-21; user sign-off pending execution) — **not yet executed**
- **Created:** 2026-07-21
- **Depends on:** Phase 2 (merged to `main` @ `663dc5b`, PR #2), phase-03 spec @ `7db6dec`

---

## Scope

- **In:** Keycloak 26 in compose + checked-in realm export; `@erp/auth` (principals, sessions under FORCE RLS via token-hash GUC policy, CASL ability factory); `ai_ro` DB role + write-cage; api BFF (`/auth/login|callback|logout|me`, opaque cookie, guards, custom-header CSRF); `platform.idempotency_keys` + `withIdempotency`; approval engine (definitions/requests/steps, propose/decide, savepoint execute, `stock.adjust` executor, SLA consumer); approval HTTP API + error-mapping convention; relay quarantine (`attempts`/`quarantined_at`); saga engine (instances/steps, registry, outbox-driven transitions, approval bridge, `stock.issue` demo saga, compensation); deterministic negative suite; journal D-026+.
- **Out (deferred, per spec §9):** WCAG Keycloak theme → first frontend phase; delegation/OOO + threshold auto-approve → first business module; MDM + Day-0 provisioning → Phase 3.5; admin bulk session revocation → Day-0/admin; full CSRF tokens → SPA phase; tenant-less infra idempotency scopes → first real need. **Non-goals:** no AI substrate, no SAP surface.

## Decisions already made (spec-settled — do not relitigate)

1. Composable primitives: `@erp/auth` + separate approval/saga engines bridged by an approval step type (deviation from §7's "ONE engine" wording — record as D-NNN).
2. Sessions under FORCE RLS via `app.session_token_hash` GUC policy (USING **and** WITH CHECK); no catalog-test exemptions.
3. Execute inline on final approve, **executor inside a savepoint**: business write rolls back on failure, the decision commits as fact (request → terminal `failed`, audit + `ApprovalExecutionFailed`).
4. Saga transitions are **outbox-driven only** (`SagaStepReady`/`SagaResumed` in the same tx); direct `boss.send` from handlers is forbidden.
5. `idempotency_keys` is tenant-scoped (`tenant_id NOT NULL`, standard tenant policy); infra scopes deferred.
6. SLA escalation with no configured role = flag-only (mark + event, no reassignment).
7. Error mapping: 409 version-conflict/already-decided, 422 hash-mismatch, 403 not-assigned/SoD, 404 missing; execution-failure responses say "decision recorded, request failed, nothing written".
8. Session defaults (plan-time per spec §11): opaque token = 32 random bytes base64url; absolute TTL 12h; idle timeout 60min (sliding `last_seen_at`); cookie `erp_session`, httpOnly, SameSite=Lax, Secure when TLS. Revisit at Day-0.
9. `approval_definitions` seeds: test-fixture-only this phase (`seedBaseline` untouched — spec §11 closed here).

## Conventions for every task (Phase-2 rules still bind)

- **TDD:** failing test → see red → minimal implementation → green → commit. Conventional commits, one logical change each.
- **Context7/registry re-verify at the touching task** (openid-client v6, @casl/ability v7, Keycloak 26 realm-import flags, drizzle savepoints) and confirm new catalog pins install.
- **Branch `phase-03-trust-decision-spine`** off `main`; NEVER commit to main; push at the end; the user opens the PR: `https://github.com/Abishek-Ravikumar-08/Kitesurf_ERP/compare/main...phase-03-trust-decision-spine?expand=1`
- **Migrations:** every migration task bumps `EXPECTED_SCHEMA_VERSION` (v7 → **v13** by the end) and asserts it via the migrate tests; generated SQL reviewed + checked in; custom SQL via `drizzle-kit generate --custom`. **No cross-file schema imports** (D-022): every new schema file inlines `pgSchema(...)` + its policy with sync comments; cross-file FKs as plain SQL in custom migrations.
- **Build before dependent tests:** `pnpm -r build` (or upstream-only on RED). CI order unchanged.
- Every domain mutation: counter/row + audit + outbox in ONE tx under `withTenantTx`; **RLS probes for every new table** (context-less + cross-tenant → 0 rows; sessions additionally: no GUC → 0 rows, wrong hash → 0 rows, write without GUC rejected).
- Keycloak-dependent int tests: one `GenericContainer` per suite that needs it (most don't), realm imported at start; container helper lives in `packages/auth/src/testkit.ts`.

---

## File structure (created/modified this phase)

```
pnpm-workspace.yaml                       # + openid-client, @casl/ability, cookie-parser (+ @types) pins
docker-compose.yml                        # + keycloak service (quay.io/keycloak/keycloak:26.4, --import-realm)
infra/keycloak/realm-erp.json             # checked-in realm export                          [NEW]
.env.example                              # + KEYCLOAK_URL, KEYCLOAK_CLIENT_ID/SECRET, SESSION_* knobs

packages/db/
  src/schema/sessions.ts                  # platform.sessions (token-hash GUC policy)        [NEW]
  src/schema/idempotency.ts               # platform.idempotency_keys                        [NEW]
  src/schema/approval.ts                  # approval_definitions/_requests/_steps            [NEW]
  src/schema/saga.ts                      # saga_instances/saga_steps                        [NEW]
  src/schema/outbox.ts                    # + attempts, quarantinedAt columns
  src/migrate.ts                          # version → 8, 9, 10, 11, 12, 13 per task
  drizzle/                                # 0013+ generated + custom migrations

packages/auth/                            # @erp/auth                                        [NEW]
  package.json tsconfig.json vitest.config.ts vitest.int.config.ts
  src/index.ts                            # barrel: principals, sessions, abilities
  src/principals.ts                       # HumanPrincipal | ServicePrincipal | AiPrincipal
  src/sessions.ts (+ sessions.int.test.ts)# createSession/lookupSession/revokeSession/sweepExpired
  src/abilities.ts (+ abilities.test.ts)  # CASL ability factory (roles → abilities, ai_ro cage)
  src/testkit.ts                          # startKeycloak() GenericContainer helper + headlessLogin()

packages/contracts/
  src/events/approval.ts, saga.ts         # 8 event payload schemas (spec §5 list)           [NEW]
  src/api/approval.ts                     # HTTP DTOs (propose/decide/list/detail)           [NEW]
  src/events/registry.ts                  # + approval/saga event registrations

packages/platform/
  src/idempotency.ts (+ .int.test.ts)     # withIdempotency(tx, scope, key, fn)              [NEW]
  src/approval.ts (+ approval.int.test.ts)# defineApproval/propose/decide/execute machinery  [NEW]
  src/approval-executors.ts               # executor registry + stock.adjust executor        [NEW]
  src/approval-sla.ts (+ .int.test.ts)    # sweepOverdueSteps (SLA/escalation, flag-only)    [NEW]
  src/saga.ts (+ saga.int.test.ts)        # engine: start/executeStep/resume/compensate      [NEW]
  src/saga-registry.ts                    # SagaDefinition registry + stock.issue demo saga  [NEW]
  src/outbox-relay.ts (+ test)            # quarantine: attempts++, skip quarantined, cap N=5
  src/errors.ts                           # + approval/saga/idempotency error family

apps/api/
  src/auth/auth.module.ts                 # OIDC config provider + controllers + guards      [NEW]
  src/auth/auth.controller.ts             # /auth/login /auth/callback /auth/logout /auth/me [NEW]
  src/auth/session.guard.ts, casl.guard.ts, csrf-header.guard.ts                             [NEW]
  src/auth/auth.int.test.ts               # headless OIDC code flow (Testcontainers KC)      [NEW]
  src/approvals/approvals.controller.ts (+ approvals.int.test.ts)                            [NEW]

apps/worker/
  src/registry.ts                         # PROD_REGISTRY gains approval/saga consumer queues
  src/consumers/*.ts (+ tests)            # approval-sla-check handler, saga-step-execute handler [NEW]
```

---

## Task 0: Branch + plan status

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b phase-03-trust-decision-spine`
- [ ] **Step 2:** Edit this file's `**Status:**` → `🚧 in progress`.
- [ ] **Step 3:** `git add plans/phase-03-trust-decision-spine.md && git commit -m "docs(plans): phase-03 trust + decision spine - mark in progress"`

## Task 1: Keycloak infra — compose, realm-as-code, catalog pins, testkit scaffolding

**Files:** Modify `pnpm-workspace.yaml` (catalog: `openid-client: ^6.8.4`, `@casl/ability: ^7.0.1`, `cookie-parser: ^1.4.7`, `@types/cookie-parser: ^1.4.7`), `docker-compose.yml`, `.env.example`. Create `infra/keycloak/realm-erp.json`.

- [ ] **Step 1:** Catalog pins + `pnpm install` → clean lockfile (confirm each pin resolves; re-verify openid-client v6 + CASL v7 APIs via Context7 now).
- [ ] **Step 2:** Compose service (dev-mode is fine for the dev stack — appliance hardening is Phase 3.5+):
```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.4
    command: ["start-dev", "--import-realm"]
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports: ["8081:8080"]
    volumes: ["./infra/keycloak:/opt/keycloak/data/import:ro"]
```
(Verify the Keycloak-26 bootstrap-admin env names and import path against current docs at execution; adjust if drifted and note it.)
- [ ] **Step 3:** `infra/keycloak/realm-erp.json` — realm `erp` containing: confidential client `erp-api` (authorization-code flow; `redirectUris: ["http://localhost:3000/auth/callback"]`; a fixed dev secret), client `ai-service` (service-account/client-credentials, no browser flow — reserved for Phase 4), realm roles `erp-admin`, `warehouse-approver`, `erp-user`, and deterministic test users `alice` (erp-admin + warehouse-approver), `bob` (erp-user), `carol` (warehouse-approver) with fixed passwords and a `tenant_id` user attribute mapped into tokens via a protocol mapper — **the attribute value is the seed's `DEV_TENANT_ID` literal (`00000000-0000-7000-8000-000000000001`)** so Task 8's HTTP tests and the seeded data agree without cross-task coordination. Author it by hand OR boot Keycloak once, configure, and `kc.sh export` — either way the checked-in JSON is the source of truth and MUST import cleanly (verified in Step 4).
- [ ] **Step 4 (verification):** `docker compose up -d keycloak` → wait → `curl -s http://localhost:8081/realms/erp/.well-known/openid-configuration` returns the issuer. Document output. (`.env.example` gains `KEYCLOAK_URL=http://localhost:8081`, `KEYCLOAK_REALM=erp`, `KEYCLOAK_CLIENT_ID=erp-api`, `KEYCLOAK_CLIENT_SECRET=<dev>`, `SESSION_TTL_HOURS=12`, `SESSION_IDLE_MINUTES=60`.)
- [ ] **Step 5:** Commit — `feat(infra): keycloak 26 dev service with checked-in erp realm export`

## Task 2: `@erp/auth` is born — sessions under FORCE RLS (schema v8)

**Files:** Create `packages/auth/{package.json,tsconfig.json,vitest.config.ts,vitest.int.config.ts}`, `packages/auth/src/{index.ts,principals.ts,sessions.ts,sessions.int.test.ts,testkit.ts}`, `packages/db/src/schema/sessions.ts`, migrations. Modify db barrels/config, `migrate.ts` → **8**.

- [ ] **Step 1:** Package scaffold mirroring `@erp/platform` (ESM, dist exports, 4 scripts). Deps: `@erp/db`, `@erp/kernel` workspace; `drizzle-orm`, `zod` catalog. DevDeps: `@testcontainers/postgresql`, `testcontainers` (GenericContainer), `typescript`, `vitest`. `pnpm install`.
- [ ] **Step 2:** Schema `packages/db/src/schema/sessions.ts` (inline pattern, NO tenantIsolation — the token-hash policy instead):
```ts
export const sessions = platformSchema.table("sessions", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  rolesSnapshot: jsonb("roles_snapshot").notNull(), // string[]
  idTokenHint: text("id_token_hint"),               // for RP-initiated logout
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
  pgPolicy("sessions_token_bearer", {
    as: "permissive", for: "all",
    using: sql`token_hash = current_setting('app.session_token_hash', true)`,
    withCheck: sql`token_hash = current_setting('app.session_token_hash', true)`,
  }),
]);
```
Generate + review; custom migration `sessions-rls-force`: ENABLE+FORCE (grants ride platform default privileges). Bump v8.
- [ ] **Step 3 (failing tests first):** `sessions.int.test.ts` — cases: (1) `createSession` (as `app_rw`, GUC set to the new token's hash) → row present via `lookupSession(token)`; (2) lookup with WRONG token → null; (3) NO GUC (raw `app_rw` select) → 0 rows; (4) write without GUC → rejected (WITH CHECK); (5) revoke → subsequent lookup null; (6) expiry: `expiresAt` past → lookup null AND `sweepExpired` (privileged handle) deletes it; (7) idle timeout: `lastSeenAt` older than idle window → lookup null; fresh lookup bumps `lastSeenAt`; (8) catalog blocklist test in `@erp/db` still green (sessions has ENABLE+FORCE). RED → implement.
- [ ] **Step 4:** Implement `sessions.ts`: `generateToken()` (32 random bytes → base64url), `hashToken` (sha256 hex), `createSession(db, {tenantId,userId,roles,idTokenHint,ttlHours,idleMinutes})` → `{token, session}` — runs its own tx: `set_config('app.session_token_hash', hash, true)` + `SET LOCAL ROLE app_rw` + insert; `lookupSession(db, token, {idleMinutes})` → same GUC dance, select where not revoked/expired/idle-stale, bump `lastSeenAt`; `revokeSession(db, token)`; `sweepExpired(db)` (privileged; worker cron candidate — Phase 3 exposes the function, wiring the cron is optional). `principals.ts`: the three principal types (Human: tenantId/userId/roles; Service; Ai: fixed read+create-proposal). Barrel.
- [ ] **Step 5:** Green: `pnpm --filter @erp/db test:int` (catalog + migrate v8) + `pnpm --filter @erp/auth test:int`. Boundaries clean (auth → db edge resolves — repeat the Task-2-Phase-2 depcruise JSON check for the NEW package edge).
- [ ] **Step 6:** Commit — `feat(auth,db): platform.sessions under FORCE RLS via token-hash GUC policy`

## Task 3: CASL ability factory + the `ai_ro` cage (schema v9)

**Files:** Create `packages/auth/src/abilities.ts` (+ `abilities.test.ts`), custom migration `ai-ro-role`. Modify `migrate.ts` → **9**, auth barrel.

- [ ] **Step 1 (failing unit tests):** ability factory — `erp-admin` can `manage all`; `warehouse-approver` can `decide Approval` + read domains; `erp-user` read-only domains + `create Approval`; **AiPrincipal**: can `read` + `create Approval` and `cannot` everything else (assert `cannot('decide','Approval')`, `cannot('update','StockItem')` etc.). Proposer≠approver is enforced at the engine level (Task 6), not in CASL — note it.
- [ ] **Step 2:** Implement with `AbilityBuilder` + `createMongoAbility` (v7 API verified). Subjects are strings (`'Approval'`, `'StockItem'`, `'all'`); actions `read|create|decide|execute|manage`. Export `AppAbility`, `abilityFor(principal)`.
- [ ] **Step 3:** Custom migration `ai-ro-role` (idempotent role creation like `app_rw`'s): `CREATE ROLE ai_ro` (guarded), `GRANT USAGE` on platform/md/wh/fin, `GRANT SELECT ON ALL TABLES` + default privileges SELECT-only, explicit `REVOKE INSERT/UPDATE/DELETE/TRUNCATE ... FROM ai_ro` on all four schemas. Bump v9. Int test (`packages/db` or auth int): a `SET LOCAL ROLE ai_ro` session can SELECT (with tenant GUC where RLS applies) but INSERT/UPDATE/DELETE on `wh.stock_items`, `platform.approval_requests` (once it exists — assert what exists now, extend in Task 6), `md.materials` → permission denied. **This is the write-cage negative test.**
- [ ] **Step 4:** Green + commit — `feat(auth,db): CASL ability factory + ai_ro read-only cage`

## Task 4: api BFF auth module — OIDC code flow over real Keycloak

**Files:** Create `apps/api/src/auth/*` (module, controller, 3 guards, int test), `packages/auth/src/testkit.ts` content. Modify `apps/api/package.json` (deps: `@erp/auth` workspace, `openid-client`, `cookie-parser` catalog), api config/env (KEYCLOAK_* + SESSION_* vars), `app.module.ts`.

- [ ] **Step 1:** `testkit.ts` — `startKeycloak()`: `new GenericContainer("quay.io/keycloak/keycloak:26.4").withCommand(["start-dev","--import-realm"]).withEnvironment({KC_BOOTSTRAP_ADMIN_USERNAME:"admin",KC_BOOTSTRAP_ADMIN_PASSWORD:"admin"}).withCopyFilesToContainer([{source: <realm-erp.json>, target: "/opt/keycloak/data/import/realm-erp.json"}]).withExposedPorts(8080).withWaitStrategy(Wait.forHttp("/realms/erp/.well-known/openid-configuration", 8080))` (long startup — 120s+ timeout); `headlessLogin(page-less)`: fetch the authorization URL → parse the Keycloak login form action from HTML → POST username/password with the form's cookies → capture the 302 redirect to the callback URL. Pure fetch/undici, no browser.
- [ ] **Step 2 (failing int test):** `auth.int.test.ts` (Testcontainers PG + KC): (1) `GET /auth/login` → 302 to Keycloak with PKCE+state, verifier stored server-side (short-lived `login_flow` cookie or in-memory keyed by state — implementer's choice, document it); (2) full headless flow: login → callback → `Set-Cookie erp_session` (httpOnly) → `GET /auth/me` returns alice's principal (tenant from token attribute, roles from realm); (3) `/auth/me` without cookie → 401; (4) `POST /auth/logout` (with CSRF header) → session revoked → `/auth/me` 401; (5) mutating request without `x-erp-csrf: 1` header → 403 (csrf-header guard); (6) callback with bad state/verifier → 401, no session row.
- [ ] **Step 3:** Implement: `auth.module.ts` provides an openid-client `Configuration` via `discovery()` at bootstrap (fail-fast if Keycloak unreachable — but ONLY when auth endpoints are enabled; `/health`+`/ready` must not depend on Keycloak); controller per the verified v6 API; `SessionGuard` (cookie → `lookupSession` → attach principal to request), `CaslGuard` (factory + `@RequireAbility(action, subject)` decorator), `CsrfHeaderGuard` (mutations require the custom header). Wire `cookie-parser` middleware.
- [ ] **Step 4:** Green (`test:int` incl. existing `/ready` suite untouched), unit lane, boundaries (api→auth edge). Commit — `feat(api,auth): BFF auth - OIDC code flow, opaque sessions, CASL + CSRF guards`

## Task 5: `withIdempotency` — the §8 primitive (schema v10)

**Files:** Create `packages/db/src/schema/idempotency.ts`, `packages/platform/src/idempotency.ts` (+ int test), migrations. Modify barrels, `migrate.ts` → **10**.

- [ ] **Step 1:** Schema: `platform.idempotency_keys` — `tenantId uuid NOT NULL`, `scope text NOT NULL`, `key text NOT NULL`, `result jsonb`, `createdAt` — `primaryKey(tenantId, scope, key)`, standard inlined tenant policy, ENABLE+FORCE custom migration. v10.
- [ ] **Step 2 (failing tests):** (1) first call runs `fn`, stores result, returns it; (2) second call with same (scope,key) does NOT run `fn` (spy/counter), returns stored result; (3) two CONCURRENT calls → exactly one `fn` execution (property test, `inParallel`, unique-violation loser waits/returns stored — document the chosen strategy: `INSERT ... ON CONFLICT DO NOTHING RETURNING`; loser re-selects and if the winner's tx hasn't committed, loser BLOCKS on the insert conflict — use plain insert + catch unique-violation + re-select after, which serializes correctly); (4) RLS probes; (5) fn throwing → no key row persists (same-tx atomicity: key row rolls back with the work — this is the point of same-tx idempotency).
- [ ] **Step 3:** Implement `withIdempotency<T>(tx, scope, key, fn: () => Promise<T>): Promise<T>` per above. Green. Commit — `feat(platform,db): tenant-scoped idempotency keys (withIdempotency)`

## Task 6: Approval engine core — schema, propose, decide (schema v11)

**Files:** Create `packages/db/src/schema/approval.ts`, `packages/platform/src/approval.ts` (+ int test), `packages/contracts/src/events/approval.ts`, migrations. Modify contracts registry/barrel, platform barrel/errors, `migrate.ts` → **11**.

- [ ] **Step 1:** Schema (inline pattern; FKs cross-file → custom migration SQL): `approval_definitions` (id, tenantId, kind, version int, config jsonb, active bool; unique (tenant,kind,version)); `approval_requests` (id, tenantId, kind, definitionVersion, payload jsonb, payloadHash, aggregateType, aggregateId, expectedVersion int nullable, proposerId uuid, state text default 'pending' CHECK in (pending,approved,rejected,cancelled,executed,failed), currentStep int default 1, correlationId, failureReason text nullable, timestamps); `approval_steps` (id, requestId, tenantId, stepNo, assigneeRole, escalated bool default false, state CHECK in (pending,approved,rejected,skipped), decidedBy, decidedAt, comment, slaDeadlineAt timestamptz nullable). ENABLE+FORCE all three; v11. Zod config schema for definitions (`steps: [{assigneeRole, slaMinutes?, escalationRole?}]`) validated at `defineApproval`.
- [ ] **Step 2:** Contracts: `ApprovalRequestedV1{requestId,kind,aggregateType,aggregateId,payloadHash}`, `ApprovalStepDecidedV1{requestId,stepNo,decision,decidedBy}`, `ApprovalExecutedV1{requestId,kind}`, `ApprovalRejectedV1{requestId}`, `ApprovalExecutionFailedV1{requestId,reason}`, `ApprovalStepOverdueV1{requestId,stepNo,escalated}` — registry + unit tests (round-trip + rejection each).
- [ ] **Step 3 (failing int tests):** (1) `defineApproval` (audited, no event) + `propose(tx,{kind,payload,aggregate,expectedVersion,proposer})` → request pending, steps materialized from the active definition with `slaDeadlineAt = now()+slaMinutes`, audit `approval.propose`, `ApprovalRequested` outbox row, `payloadHash = sha256(stableStringify(payload))`; (2) `decide` approve step 1 of 2 → step approved, `currentStep` → 2, request still pending, audit + `ApprovalStepDecided`; (3) reject at any step → request `rejected`, remaining steps `skipped`, audit + `ApprovalRejected`; (4) **SoD**: proposer calling `decide(approve)` → `SelfApprovalError`, nothing written; (5) wrong-role decider → `NotAssignedError`; (6) already-decided step → `AlreadyDecidedError` (guarded UPDATE, Task-7-Phase-2 pattern); (7) concurrent same-step approves → exactly one wins (property); (8) RLS probes ×3 tables; (9) ai_ro extension of the Task-3 cage: ai_ro CAN insert nothing directly (DB), and the engine's `propose` called under an Ai principal works while `decide` under Ai → `NotAssignedError` (CASL-level check is the api's job; engine checks role membership passed in — decider roles come from the principal, document the seam).
- [ ] **Step 4:** Implement (`decide` takes `{requestId, stepNo, decision, decider: {userId, roles}, comment?}`; final-step approve sets request `approved` and RETURNS a marker that Task 7's `executeApproved` picks up — for now approval stops at `approved`). Green. Commit — `feat(platform): approval engine core - definitions, propose, multi-step decide with SoD`

## Task 7: Savepoint execute + executor registry + the negative suite

**Files:** Create `packages/platform/src/approval-executors.ts`. Modify `packages/platform/src/approval.ts` (+ int test), errors.

- [ ] **Step 1 (failing tests):** (1) happy path: `stock.adjust` request through both steps → on final approve, executor runs INLINE same tx: real `adjustOnHand` with `expectedVersion` → request `executed`, stock moved, audit chain (`approval.execute`) + `ApprovalExecuted` + the stock domain's own audit/outbox all present; (2) **the named savepoint-outcome assertion** (spec §8): bump the stock item's version before final approve → final approve returns/throws typed failure BUT commits: request `failed` + `failureReason`, final step `approved`, audit + `ApprovalExecutionFailed` event present, stock UNCHANGED, and the domain's would-be audit/outbox rows absent; (3) forged payload (superuser mutates `payload` after propose) → hash mismatch → same failed-with-decision-preserved shape; (4) replay: calling execute again on an `executed` request → `withIdempotency` returns stored result, no double adjust (assert stock counted once); (5) unregistered kind → typed error at propose time.
- [ ] **Step 2:** Implement: `registerExecutor(kind, (tx, payload) => Promise<unknown>)`; in `decide`'s final-approve path: `withIdempotency(tx, "approval-execute", requestId, ...)` wrapping: re-verify hash → re-check version guard via the executor's own domain guard → **`await tx.transaction(async (sp) => executor(sp, payload))`** (drizzle nested tx = SAVEPOINT, verified) → on throw of a `DomainError`: catch, mark request `failed`+reason, audit, `ApprovalExecutionFailed` event, return typed result (non-DomainError rethrows — the outer tx aborts, decision NOT preserved for infrastructure errors: document this deliberate line). `stock.adjust` executor = thin adapter to `adjustOnHand`. Green. Commit — `feat(platform): savepoint execute with re-validation - decision preserved, business write rolled back`

## Task 8: Approval HTTP API

**Files:** Create `apps/api/src/approvals/approvals.controller.ts` (+ int test), `packages/contracts/src/api/approval.ts`. Modify api module wiring, contracts barrel.

- [ ] **Step 1 (failing int tests, real KC + PG):** as alice/bob/carol via `headlessLogin`: (1) `POST /approvals` (bob proposes stock.adjust; CSRF header) → 201 with request id; (2) `GET /approvals` as carol (warehouse-approver) lists it; as bob lists own; (3) `GET /approvals/:id` shows payload + hash + chain; (4) approve chain via carol then alice → 200, final response body `{state:"executed"}`, stock actually adjusted (assert DB); (5) stale-version execution failure → **409 with body `{state:"failed", decisionRecorded:true, executed:false, reason}`** (the spec's not-a-no-op contract); (6) hash-forgery → 422 same shape; (7) bob approving own proposal → 403; (8) bob (no approver role) approving carol's step → 403; (9) unauthenticated → 401; (10) cross-tenant request id → 404.
- [ ] **Step 2:** Implement controller with Zod DTOs from contracts (`nestjs-zod` or manual pipe — match whatever the api already uses; if nothing exists yet, manual `schema.parse` in the controller is fine — no new framework deps). **Register the approval DTO schemas in the contracts OpenAPI builder** (`packages/contracts` — wherever the Phase-1 Zod→OpenAPI pipeline lives) so "the first real API contracts through the OpenAPI pipeline" stays true; assert they appear in the generated document in the contracts unit test. Error-mapping filter: `VersionConflictError|AlreadyDecidedError→409`, `PayloadHashMismatchError→422`, `NotAssignedError|SelfApprovalError→403`, missing→404. Green + boundaries. Commit — `feat(api): approval inbox API - the first CASL-guarded RLS-scoped HTTP write path`

## Task 9: SLA consumer + relay quarantine (schema v12)

**Files:** Create `packages/platform/src/approval-sla.ts` (+ int test), `apps/worker/src/consumers/approval-sla.consumer.ts` (+ test). Modify `packages/db/src/schema/outbox.ts` (+ migration → **12**), `packages/platform/src/outbox-relay.ts` (+ test), `apps/worker/src/{registry.ts,relay/relay.service.ts}`.

- [ ] **Step 1 (failing tests, platform):** `sweepOverdueSteps(db)` (privileged): finds pending steps past `slaDeadlineAt` → per step, in a tenant tx: `withIdempotency(tx,"sla-escalation", stepId, ...)`: mark `escalated=true`, audit, `ApprovalStepOverdue` event; if the definition names an `escalationRole` → reassign `assigneeRole`; else flag-only. Cases: overdue flagged once (re-sweep = no-op via idempotency); **two CONCURRENT sweeps → exactly one escalation** (`inParallel`, spec §8's named property); not-overdue untouched; escalation-role reassignment; flag-only path.
- [ ] **Step 2 (failing tests, relay quarantine):** outbox gains `attempts int default 0`, `quarantinedAt timestamptz` (generated migration, v12). Relay: claim skips `quarantined_at IS NOT NULL`; on batch failure increment claimed rows' `attempts` (in a NEW small tx — the failed tx rolled back; document the two-tx shape); rows reaching `attempts >= 5` get `quarantined_at = now()` + loud log. Test: poison event (registry maps its type to a queue; boss.send stubbed to throw for it) → after 5 ticks the row is quarantined and a LATER event still relays (head-of-line unblocked). Retire the `TODO(Phase 3)` comment.
- [ ] **Step 3:** Worker wiring: `PROD_REGISTRY` stays event→queue for saga (Task 10); SLA is cron-fed — `boss.schedule("approval-sla-check", "*/1 * * * *")` in dev/test config, handler calls `sweepOverdueSteps`. Worker int test: overdue step in DB → within the cron/tick window the step is escalated (poll ≤ 90s; or trigger the handler directly via `boss.send` to the queue for a fast deterministic test + keep one slow cron-proof test optional — implementer documents choice). Green everywhere (`pnpm --filter @erp/platform test:int`, worker suites, db migrate v12). Commit — `feat(platform,worker): SLA escalation consumer + outbox poison-row quarantine`

## Task 10: Saga engine + approval bridge + `stock.issue` demo saga (schema v13)

**Files:** Create `packages/db/src/schema/saga.ts` (+ migrations → **13**), `packages/platform/src/{saga.ts,saga-registry.ts}` (+ int test), `packages/contracts/src/events/saga.ts`, `apps/worker/src/consumers/saga-step.consumer.ts` (+ test). Modify registries, barrels, `apps/worker/src/registry.ts` (`SagaStepReady→saga-step-execute`, `SagaResumed→saga-step-execute`), approval decide path (append `SagaResumed` when a request carries a saga ref). **The saga ref lives on `approval_requests` as two nullable columns added in THIS task's custom migration (expand): `saga_instance_id uuid`, `saga_step_no int`** — set by the approval-bridge step when it opens the request; the decide path appends `SagaResumed{instanceId, stepNo, outcome}` when they are non-null.

- [ ] **Step 1:** Schema: `saga_instances` (id, tenantId, kind, context jsonb, state CHECK in (running,completed,failed,compensating,compensated), currentStep, correlationId, lastError, timestamps), `saga_steps` (id, instanceId, tenantId, stepNo, name, state CHECK in (pending,running,done,failed,compensated), attempts, lastError). ENABLE+FORCE; FK via custom SQL; v13. Contracts: `SagaStepReadyV1{instanceId,stepNo}`, `SagaResumedV1{instanceId,stepNo,outcome}` + registry.
- [ ] **Step 2 (failing int tests):** (1) `startSaga(tx,{kind,context,tenantId,correlationId})` → instance+steps rows + `SagaStepReady(1)` outbox event in the SAME tx (assert no `boss.send` anywhere in the tx path — code-review-level, plus the outbox row IS the assertion); (2) `executeSagaStep(db, {instanceId,stepNo})` (the consumer's body): tenant tx + `withIdempotency("saga-step", instanceId+":"+stepNo)` + registry `run` → step done + next `SagaStepReady` appended same tx; last step → instance `completed`; (3) approval-bridge step: `run` opens an approval request (with `sagaRef`) and returns PARKED → step stays `running`, no next event; approving the request through the engine appends `SagaResumed` in the decision tx → consumer resumes → step done; rejection → `SagaResumed{outcome:"rejected"}` → compensation; (4) compensation: step-3 `run` throws terminally (attempts exhausted, cap 3) → instance `compensating` → completed steps' `compensate` run in reverse (reservation released — assert counters) → `compensated`; (5) duplicate delivery of the same step job → exactly-one execution (property, `inParallel`); (6) RLS probes.
- [ ] **Step 3:** Implement engine + `stock.issue` demo saga in `saga-registry.ts`: step 1 `reserve` (compensate: `release`), step 2 approval-bridge (`stock.issue-consume` definition, fixture), step 3 `consume` + `allocateNumber("INV","2026")` (no compensate — terminal). Worker consumer: array-receiving pg-boss handler → per job `executeSagaStep`. Worker int test: end-to-end — `startSaga` → poll → parked at approval → decide via engine → poll → completed, all side effects present.
- [ ] **Step 4:** Full green: platform + worker + db + api suites, boundaries. Commit — `feat(platform,worker): outbox-driven saga engine with approval bridge and compensation`

## Task 11: Verification sweep, journal, push

- [ ] **Step 1:** Full local sweep (the CI matrix): `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test && pnpm -r test:int` — each green; paste tails. Compose check: `docker compose up -d` (PG+KC) → migrate/seed if needed → boot api → full manual-curl OIDC sanity optional; at minimum `/ready` 200 and `/auth/login` 302s to Keycloak. Document.
- [ ] **Step 2:** Tick all plan checkboxes; Status → ✅ complete (pending PR). Append `journal/DECISIONS.md` (next free numbers, expect D-026…D-033): composable-primitives deviation; sessions token-hash GUC policy; savepoint execute semantics (+ the DomainError-only line); outbox-driven saga transitions; tenant-scoped idempotency (infra scopes deferred); SLA flag-only default; library pins (openid-client v6 functional API, CASL v7, GenericContainer Keycloak); **one consolidated deferrals entry** covering the spec-§9 table (WCAG theme → frontend phase; delegation/OOO + threshold auto-approve → first business module; MDM + Day-0 → Phase 3.5; admin bulk session revocation → Day-0/admin; CSRF tokens → SPA phase; SoD matrix → open) + anything discovered at execution. Append dated `journal/PROGRESS.md` entry (append-only).
- [ ] **Step 3:** `git add -A && git commit -m "chore: phase-03 verification sweep, journal updates" && git push -u origin phase-03-trust-decision-spine` — then STOP; the user opens the PR.

---

## Verification (Definition of Done)

- [ ] Headless OIDC code flow green vs real Keycloak 26 (login/callback/me/logout; bad-state rejected; CSRF header enforced)
- [ ] Sessions: all 4 fail-closed probes (no GUC, wrong hash, write-without-GUC, revoked/expired/idle) + catalog ENABLE+FORCE still asserted with zero exemptions
- [ ] `ai_ro` write-cage proven at DB layer + ability layer
- [ ] Approval: propose→multi-step decide→inline execute green over HTTP; SoD; concurrent-decide one-winner; **named savepoint-outcome assertion** (failed request + preserved decision + zero business writes)
- [ ] Replay of execute = provable no-op (idempotency); SLA sweep idempotent, flag-only default honored
- [ ] Relay: poison row quarantined at 5 attempts, later rows flow; `TODO(Phase 3)` comment retired
- [ ] Saga: outbox-driven transitions only; park/resume through a real approval; compensation releases the reservation; duplicate-delivery exactly-once (property)
- [ ] `EXPECTED_SCHEMA_VERSION = 13`; every migration reviewed; RLS probes on all 7 new tables
- [ ] Boundaries clean incl. the new `api→auth→db` edges; both toggles untouched-green; full local sweep = CI matrix green
- [ ] Journal D-026+ + PROGRESS appended; plan ticked; branch pushed; PR left for the user

## Risks / execution watch-items

- **Keycloak container startup time** (~30–60s) — budget 180s wait strategies; one container per needing suite only (auth api suite, worker saga suite does NOT need KC).
- **Keycloak 26 bootstrap-admin env names + import path** — re-verify at Task 1; older `KEYCLOAK_ADMIN` names were deprecated.
- **openid-client v6 + Node 24 fetch** — v6 uses global fetch; should be clean under ESM; the api is already ESM (D-020).
- **Realm export drift** — hand-edited realm JSON can silently miss protocol mappers; Task 1 Step 4's discovery-endpoint check + Task 4's full login flow are the real verification.
- **Savepoint + drizzle**: nested `tx.transaction` verified as SAVEPOINT; if the drizzle wrapper's rollback types fight the typed-failure return, fall back to raw `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` via `tx.execute` — semantics over shape.
- **Two-tx attempts-increment in the relay** (failed batch rolls back) — keep the increment tx tiny and failure-tolerant; a crash between rollback and increment just retries the batch (at-least-once, unchanged).
- **`start-dev` vs production Keycloak** — dev-mode is deliberate for Phase 3 (compose dev stack); appliance-grade KC config is a Phase 3.5/Day-0 item.

## Progress log

- 2026-07-21: Plan written from the approved phase-03 spec (@ `7db6dec`); library pins verified same-day (openid-client 6.8.4, @casl/ability 7.0.1, cookie-parser 1.4.7, quay.io/keycloak/keycloak:26.4, no @testcontainers/keycloak → GenericContainer). Plan-review loop: pending.

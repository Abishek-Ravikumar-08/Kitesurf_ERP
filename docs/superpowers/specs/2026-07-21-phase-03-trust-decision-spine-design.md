# Phase 3 — Trust + Decision Spine — Design

**Status:** draft (brainstorm-approved section by section, 2026-07-21) · **Author:** brainstormed with the user
**Parent spec:** [2026-07-16-erp-ai-native-system-design.md](2026-07-16-erp-ai-native-system-design.md) — implements the auth + approval + saga tranche of §7/§9.2/§9.4/§8, per §10.2's sub-sequencing ("auth first; then approval engine, …") and the deferrals recorded in D-019/D-024.
**Depends on:** Phase 2 (merged to `main` @ `663dc5b`, PR #2) — tenancy/FORCE RLS, hash-chained audit, transactional outbox + `apps/worker` relay, stock/locking/numbering/fiscal domains, schema v7.

---

## 1. Goal and theme

Every write in the system gains a **real principal** and a **decision path**. Phase 2 proved the mechanics (RLS, audit, outbox, correctness domains) using synthetic principals; Phase 3 replaces them with Keycloak-backed humans and service identities, adds the ONE unified approval/workflow engine and the Postgres-backed saga engine, and lands the §8 idempotency-key kernel primitive with the **first real pg-boss consumers**. This is the exact trust chain the Phase 4 AI substrate rides: `propose → approve → execute` becomes a tested, HTTP-reachable, CASL-guarded, RLS-scoped, replay-proof path before any model touches it.

## 2. Scope decisions (user-approved 2026-07-21)

1. **Phase 3 = trust + decision spine only:** auth (Keycloak OIDC BFF + CASL + `ai_ro`) → approval/workflow engine → saga engine + §8 idempotency table + first pg-boss consumers. **MDM expansion and Day-0 provisioning defer to the next tranche** (Phase 3.5), with files/AV, notifications, printing, import/export, search, public API, GDPR, licensing behind them per §10.2.
2. **HTTP surface = auth endpoints + minimal approval API.** The first authenticated, CASL-guarded, RLS-scoped HTTP *write* path ships and is proven now; saga/idempotency stay library + DB.
3. **Approval engine = core state machine + SLA timers.** Single- and multi-step chains, assignment by role, execute-time re-validation, audit, SLA/escalation via pg-boss. **Deferred:** delegation/out-of-office, threshold auto-approve, per-line anomaly flags, bulk approval UX — all need real business consumers or a frontend to verify honestly.
4. **Keycloak = realm-as-code, stock theme.** Keycloak 26 in docker-compose + Testcontainers; checked-in importable realm export. The WCAG-AA custom login theme **defers to the first frontend phase** (no verifiable target exists yet).
5. **Architecture = composable primitives** (chosen over one unified workflow engine): a new `@erp/auth` package plus separate approval and saga engines in `@erp/platform`, bridged by an approval *step type*. One branch, one PR, Phase-2-sized.

## 3. Architecture

```
apps/api ──► @erp/auth ──► @erp/db          (BFF endpoints, guards)
apps/api ──► @erp/platform (approval API calls engine functions)
apps/worker ─► @erp/platform (SLA consumer, saga executor, relay)
@erp/platform ──► @erp/auth?  NO — platform takes principals as plain data (no dependency)
@erp/auth ──► @erp/kernel, @erp/db
```

- **`@erp/auth` (NEW package):** principal types (`HumanPrincipal`, `ServicePrincipal`, `AiPrincipal`), session repository, CASL ability factory (Keycloak realm roles → abilities). No HTTP; the api's auth module consumes it. dependency-cruiser enforces `api → auth → db` with no cycles; `@erp/platform` stays principal-agnostic (takes `tenantId`/`userId`/ability results as data) so worker and api compose it freely.
- **Approval + saga engines live in `@erp/platform`** beside the Phase 2 domains, following the established convention: functions take a `Tx`, compose into one atomic transaction, write audit + outbox in the same tx, and are exercised by Testcontainers integration tests.
- **Keycloak 26** joins `docker-compose.yml`; integration tests use a Testcontainers Keycloak with the same checked-in realm export (confidential `erp-api` client for code flow, `ai-service` client-credentials client reserved for Phase 4, realm roles, deterministic test users).

## 4. Auth (§9.4)

**BFF sessions, no browser tokens.** `GET /auth/login` (302 → Keycloak, PKCE + `state`) · `GET /auth/callback` (code exchange → create `platform.sessions` row → set opaque httpOnly SameSite=Lax cookie) · `POST /auth/logout` (revoke) · `GET /auth/me` (principal). The session row stores a **sha256 hash** of the cookie token, tenant, user, a roles snapshot, expiry, `revoked_at`.

**Sessions under FORCE RLS — token-hash GUC policy.** Session lookup happens before any tenant context exists, and the Phase 2 catalog test forces ENABLE+FORCE on every table in every non-system schema. Sessions therefore get their own fail-closed policy keyed on a dedicated GUC:

```sql
USING (token_hash = current_setting('app.session_token_hash', true))
```

The session service sets that GUC (transaction-local) to the presented token's hash inside the lookup transaction, as `app_rw`. A session row is visible **only to the bearer of its own token**; no GUC → zero rows. The catalog blocklist test stays honest with no exemptions. Expiry sweep runs on the worker's privileged connection (same pattern as the outbox relay). **Known limitation (recorded):** admin "revoke all sessions for user X" requires a privileged path — deferred to Day-0/admin tooling.

**CASL.** The ability factory maps realm roles + tenant to abilities; NestJS guards enforce them on the approval endpoints; **RLS remains the fail-closed DB backstop** (defense in depth, unchanged). `withTenantTx` now receives real `tenantId`/`userId` from the session — Phase 2's synthetic principals retire.

**`ai_ro` lands as structure now.** A migration creates the Postgres role (SELECT-only on domain schemas, zero write grants, single future create-proposal capability); `AiPrincipal` is the CASL shape (read + create-proposal only). A **deterministic negative test** proves an `ai_ro` session can write no domain table and can never approve — the Phase 4 substrate plugs into a proven cage.

**CSRF stance (headless phase):** SameSite=Lax cookie + a required custom header on mutating endpoints. Full CSRF-token machinery defers to the SPA phase (recorded).

## 5. Approval/workflow engine (§7)

**Tables (`platform` schema, all ENABLE+FORCE RLS + tenant isolation, per Phase 2 conventions):**

- `approval_definitions` — config-driven chains: `kind` (e.g. `stock.adjust`), version, Zod-validated config JSONB (ordered steps: assignee role, optional `slaMinutes`, optional escalation role), active flag, per-tenant. DB-resident because approval chains are what ERP customers customize.
- `approval_requests` — the proposal: payload JSONB + `payload_hash` (`stableStringify` → sha256), target aggregate ref (`aggregateType`/`aggregateId`) + **expected aggregate version** captured at propose time, proposer, state (`pending → approved | rejected | cancelled`, then `executed | failed`), current step, correlation id, timestamps.
- `approval_steps` — one row per chain step: step number, assignee role, state (`pending | approved | rejected | skipped`), `decided_by/decided_at`, comment. Chains advance strictly in order.

**Deciding.** `approve`/`reject` run under `withTenantTx` as the deciding principal. CASL checks the step's assignee role; minimal SoD rule from day one: **the proposer can never approve their own request** (the full risk-tiered SoD matrix remains a §12 open question). Every transition writes audit + an outbox event (`ApprovalRequested`, `ApprovalStepDecided`, `ApprovalExecuted`, `ApprovalRejected`, `ApprovalStepOverdue` — versioned Zod contracts in `@erp/contracts`).

**Execute-time re-validation (AI-safety invariant #3), inline and atomic.** The final approval executes **in the same transaction**: re-verify `payload_hash` against the stored payload → re-check CASL → re-check the aggregate version guard → run the registered executor (`kind → (tx, payload) => …`) → mark executed → audit → outbox. Stale version → typed failure, nothing written. Idempotent via the §8 table keyed by request id: a replayed execute is a provable no-op. This matches D-003 (execute commits atomically with the business write + audit).

**Honest demo consumer.** The Phase 3 registered kind is `stock.adjust`: the payload is a real `adjustOnHand` input and the executor calls the real Phase 2 function with `expectedVersion`. Negative tests are therefore real: forged payload (hash mismatch) rejected; stale version rejected; replayed execute no-ops; `ai_ro` may propose, never approve/execute.

**SLA/escalation — the first real pg-boss consumer.** A cron-fed `approval-sla-check` queue sweeps overdue pending steps → audit + `ApprovalStepOverdue` event + reassignment to the escalation role when configured. The handler is idempotency-keyed per (step, escalation) so at-least-once redelivery cannot double-escalate.

## 6. Saga engine + §8 idempotency + eventing hardening

**`platform.idempotency_keys` (§8 kernel primitive).** `(scope, key)` primary key, `tenant_id`, optional stored result JSONB, `created_at`. One helper — `withIdempotency(tx, scope, key, fn)` — inserts-or-detects in the same transaction as the work; a duplicate returns the stored outcome and runs nothing. Tenant-scoped uses (approval execute, saga steps) pass through RLS; infra scopes are writable only from the worker's privileged connection, so `app_rw` physically cannot forge infra idempotency rows.

**Saga engine (§9.2).** `saga_instances` (kind, context JSONB, state `running → completed | failed → compensating → compensated`, correlation, current step) + `saga_steps` (ordered, per-step state, attempt count, last_error). Code-side registry: kind → ordered steps, each `{ name, run(tx, ctx), compensate?(tx, ctx) }`. Steps execute via a pg-boss `saga-step-execute` queue; each step runs inside `withTenantTx` (the worker's privileged connection drops to `app_rw`, so RLS binds business writes) wrapped in idempotency key `(saga:<instance>, <step>)`. Terminal step failure compensates completed steps in reverse. **Local compensation only** — distributed edges (SAP, remote GPU) stay reserved per §9.2.

**Approval bridge.** An `approval` step type opens an `approval_request` and **parks** — the saga is "a row awaiting action, not a suspended execution context." The approval engine's decision path enqueues the resume; rejection triggers compensation.

**Demo saga (real, not synthetic): `stock.issue`.** Step 1 `reserve` → step 2 approval-bridge (consumption requires sign-off) → step 3 `consume` + `allocateNumber("INV")`. Rejection or failure compensates by releasing the reservation. One flow exercises reservation, consumption, gapless numbering, approvals, compensation, and idempotent redelivery.

**Eventing hardening (retires D-024's recorded debt).** `platform.outbox` gains `attempts` + `quarantined_at`; the relay claim skips quarantined rows, increments attempts on failed batch inclusion, and quarantines after N attempts with a loud log — head-of-line blocking becomes bounded and observable. `ConsumerRegistry` gets its first production entries.

## 7. HTTP surface

All request/response DTOs are Zod contracts in `@erp/contracts` (the first real API contracts through the OpenAPI pipeline).

- **Auth:** `GET /auth/login` · `GET /auth/callback` · `POST /auth/logout` · `GET /auth/me`.
- **Approvals:** `POST /approvals` (propose) · `GET /approvals` (my pending, CASL-filtered) · `GET /approvals/:id` (payload + hash + chain) · `POST /approvals/:id/steps/:n/approve|reject` (comment optional; final approve executes inline).
- **Error-mapping convention (repo-wide precedent):** version conflict / already-decided → **409**; payload-hash mismatch → **422**; not-assigned / SoD violation → **403**; missing → 404. Phase 4's AI proposals inherit this mapping.

## 8. Testing (Definition of Done inputs)

Same rhythm as Phase 2 — TDD per task; Testcontainers Postgres **plus Testcontainers Keycloak**; unit + integration lanes; property tests where concurrency matters.

- **OIDC code flow headless:** fetch login page → POST credentials → follow redirects → cookie → `/auth/me`. Logout revokes (session row `revoked_at`, subsequent 401).
- **Approval flow over real HTTP:** propose → approve → the real `adjustOnHand` lands (DB state + audit + outbox asserted).
- **Deterministic negative suite (§9.10, brought forward):** forged payload, replayed execute, stale version, mismatched hash, proposer-self-approval, not-assigned 403, cross-tenant invisibility, `ai_ro` write-cage — each proven at both the CASL and DB layers.
- **Saga:** park/resume through a real approval; compensation on rejection; duplicate-job injection proves idempotency; concurrent same-step delivery → exactly-one execution (property test).
- **Relay quarantine:** a deliberate poison row is bounded (quarantined after N attempts) and later rows still relay.
- **RLS probes on every new table** (sessions probed via the token-hash GUC policy: no GUC → zero rows; wrong hash → zero rows).
- **Concurrency properties:** concurrent approve on the same step → exactly one decider wins; concurrent SLA sweeps → no double escalation.

## 9. Deferrals (each recorded as a D-NNN at execution)

| Deferred | To | Why |
|---|---|---|
| WCAG-AA Keycloak login theme | first frontend phase | no verifiable target (axe/Playwright) exists yet |
| Delegation/out-of-office, threshold auto-approve, per-line anomaly flags, bulk approval UX | first business module | would be designed against zero real approval types |
| MDM governance beyond the materials stub; Day-0 provisioning | Phase 3.5 tranche | §10.2 sequencing; both need auth to exist first |
| Admin bulk session revocation | Day-0/admin tooling | needs the privileged admin path |
| Full CSRF-token machinery | SPA phase | headless phase uses SameSite=Lax + custom-header requirement |
| Risk-tiered SoD approver matrix | open question (§12) | minimal proposer≠approver rule ships now |

**Non-goals:** no AI substrate (Phase 4), no SAP surface (Phase 5). Both toggles stay green.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Keycloak in the int-test loop makes CI slow/flaky | one Keycloak container per suite that needs it (most suites don't); realm import at container start; budget like Testcontainers PG |
| Session GUC policy is novel — subtle bypass | dedicated RLS probes (no GUC, wrong hash, cross-tenant) + review focus; token is opaque + hashed at rest |
| Approval executor becomes a god-registry | executors are thin adapters to existing `@erp/platform` functions; one kind in Phase 3 |
| Saga engine over-abstracts before real consumers | one real demo saga; registry API kept payload-compatible; no BPMN, no DSL |
| Inline execute on final approve makes slow executors block the HTTP request | acceptable for Phase 3 (executors are single-tx domain functions); revisit with async execution + status polling if an executor ever crosses a network boundary |

## 11. Open questions

- Session lifetime + refresh policy (idle timeout vs absolute) — pick sensible defaults at plan time, revisit at Day-0.
- Whether `approval_definitions` seeds ship in `seedBaseline` (dev convenience) or stay test-fixture-only.
- Escalation reassignment semantics when no escalation role is configured (flag-only vs no-op).

# Backend Workflow — AI-Native ERP

> A repeatable, tool-driven workflow for building the **ERP backend**: the NestJS modulith
> (9 modules + Master Data + SAP-ACL + AI-Governance), the Python ML sidecars, the AI plane,
> the SAP sync engine, and the on-prem appliance.
>
> This is the backend counterpart to **[workflow.md](workflow.md)** (the 3D-immersive frontend).
> The authoritative system design is the spec:
> **[docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md](docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md)** — read it before touching backend code; this doc is *how we work*, the spec is *what we build*.

---

## 0. The one idea that makes this "best in class"

**Never let the backend run blind — and never trade correctness for speed.** The frontend proves work by *seeing* the render; the backend proves work by *exercising the real flow against a real database and observing the truth it leaves behind* — rows, emitted events, audit entries — not by trusting unit tests alone.

```
        ┌────────────────────────────────────────────────┐
        ▼                                                 │
   WRITE the test first ─▶ BUILD a small slice ─▶ RUN it against a
   (TDD: behavior)          (layered: api→app→        REAL Postgres
        │                    domain→infra)          (Testcontainers)
        │                                                 │
        ▼                                                 ▼
   OBSERVE the truth: DB state, emitted events,     REVIEW ▶ VERIFY ▶ COMMIT
   audit rows, RLS scoping, invariants held ────────▶ (small, green slice)
```

An ERP is a **correctness-first, money-and-stock system**. A pretty API that oversells inventory, gaps an invoice number, or lets an AI agent write without approval is a *failure*, however fast it shipped. Every slice runs the loop above until the invariants hold.

### Golden rules (apply to every backend task)

1. **Context7 first.** Before writing library code, pull current docs via Context7 — NestJS, Drizzle, Zod, pg-boss, `@sap-cloud-sdk`, the Vercel AI SDK, Keycloak, and FastAPI/pydantic APIs drift, and stale code is the #1 failure mode. Re-verify after any version bump.
2. **Correctness & data-integrity first.** Money, stock, and number ranges are sacred. Reservation/ATP, optimistic locking, and gapless ranges get **property tests under concurrency** — never "looks right." Money is `NUMERIC` + decimal.js (integer minor-units only for the posted ledger); never floats.
3. **The five AI-safety invariants are law** (see §8). The AI principal has **zero write scope**; every number comes from a deterministic, RLS-scoped query, never the model; `execute` re-validates against the exact approved payload; document/RAG text is untrusted data; egress + cost are structurally gated. If a change could let an AI action write without human approval, stop.
4. **Both toggles stay green.** Every change must keep **standalone AND SAP-connected** working, and **cloud AND local-AI** working. The SAP adapter and the `LlmProvider` are ports; test the matrix, don't assume.
5. **Migrations are expand/contract, always reversible.** Old and new app versions must tolerate the interim schema (the appliance does rolling updates + rollback). No long locks on big tables.
6. **Boundaries are enforced, not suggested.** Modules talk only via public-API ports (sync, consistency-critical reads + the atomic `reserve()`) or the transactional outbox (async workflow progression). `dependency-cruiser` fails the build on a violation. AI-Governance never writes domain tables.
7. **Small, verified slices.** One vertical slice, run the loop, commit. Idempotency (pg-boss is at-least-once) and an audit row are part of "done," not an afterthought.
8. **Manual approval is on.** MCP tools and write/destructive commands prompt you — approve deliberately.

---

## 1. Our toolkit (backend)

### MCP servers
| Server | Use it to… | Phase |
|---|---|---|
| **context7** | Fetch current docs for any library (NestJS, Drizzle, Zod, pg-boss, SAP Cloud SDK, Vercel AI SDK, Keycloak, FastAPI) | Every build phase — **first** |
| **playwright** | Drive the running app end-to-end over HTTP/UI: exercise a real flow, assert resulting state | Verify loop (E2E) |
| **github** | Repos, branches, PRs, issues, Actions/CI *(needs one-time `/mcp` auth)* | Plan + ship |
| **chrome-devtools** | Only where a backend change has a page-perf surface (SSR-free here) — mostly a frontend tool | Rare |

> The **claude.ai Postman** and **github** connectors need authorization before use (claude.ai connector settings / `/mcp`); they're optional for local dev.

### Skills (auto-trigger by task description)
| Group | Skills | When they fire |
|---|---|---|
| **Process** | `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `using-git-worktrees` | Framing → planning → executing |
| **Discipline** | `test-driven-development`, `systematic-debugging`, `verification-before-completion` | Throughout — HOW we work |
| **Review** | `requesting-code-review`, `receiving-code-review`, `code-review`, `security-review` | Before merge |
| **Verify** | `verify` | Exercise the change end-to-end before "done" |
| **Data** | `dataviz` | Analytics read-model / reporting output |

> **Multi-agent design/review (opt-in).** For large or uncertain work — a new bounded context, a cross-module saga, the SAP sync engine, an AI capability — an exhaustive `Workflow` pass (parallel design → adversarial verify → synthesis) is available. It costs real tokens/time, so **ask before running it**; it's how the system design itself was produced.

---

## 2. Shared foundation (build once, in this order)

Per the spec's build order (§10). Do **not** start a module before the foundation exists — retrofitting it is the rewrite we're avoiding.

1. **Repo & platform skeleton** — pnpm monorepo, NestJS modulith scaffold + `dependency-cruiser` boundaries, `@erp/kernel` (DomainEvent envelope, Money/decimal, Quantity/UoM), Drizzle + expand/contract migrations + `schema_version` boot gate, typed license-sourced config/flags, the Zod→OpenAPI→(TS client + Pydantic) contract pipeline, Docker Compose dev stack, CI (incl. offline-eval + RLS-isolation gates), seed/demo + mock-SAP fixtures.
2. **Correctness core** — inventory reservation/ATP, optimistic locking, gapless number ranges, Money/UoM, fiscal calendar/period-close. Property-tested under concurrency.
3. **Platform kernel** — tenancy + RLS (fail-closed), hash-chained audit, the **one** approval/workflow engine, Day-0 provisioning state machine, MDM, config/flags, files+AV, notifications+SMTP, printing (PDF/ZPL), bulk import/export, global search, public API + webhooks, data lifecycle/GDPR, licensing.
4. **AI substrate** → **SAP sync engine** → **Sales & Distribution** (first module) → the rest.

---

## 3. The task workflow (any backend task)

The universal loop. Scale the ceremony to the task, but never skip the test or the boundary check.

**T1 · Frame** — `brainstorming` → what's the job-to-be-done, which **bounded context** owns it, which **events** it consumes/emits, which **invariants** it must hold (stock never negative, range gapless, audit written), and every state (empty/loading/error/partial/success, plus standalone-vs-SAP and cloud-vs-local branches).

**T2 · Plan** — `writing-plans` (use **plan mode** for anything non-trivial) → the slice, the data model + **expand/contract migration**, the **ports/contracts** (Zod schemas in `packages/contracts`), the events, a **saga** if it's a long-running/human-gated flow, RLS/CASL scoping, and the **test list** (unit + integration + contract + property).

**T3 · Context7** — pull current APIs for every library the slice touches. Don't write from memory.

**T4 · Build test-first** — `test-driven-development`:
- Write the **behavior/integration test first**, against a **real Postgres via Testcontainers** (never a mock — RLS, FKs, the outbox, and number ranges must be exercised).
- Implement the vertical slice in the layered structure: `api/` (controller + nestjs-zod) → `application/` (use-case) → `domain/` (entities, invariants) → `infra/` (Drizzle repo, adapters).
- Wire the **outbox** (business write + event + audit row in ONE transaction), **idempotency** (dedupe key + version guard), and **RLS** (`SET LOCAL` inside the transaction wrapper) + **CASL**.

**T5 · Verify loop** — do not advance until green:
- **Integration tests** pass against real Postgres; assert **DB state + emitted events + audit rows + RLS scoping** (a context-less query returns zero rows).
- **Drive the real flow** with `verify` / Playwright over HTTP: call the endpoint (or the propose→approve→execute path), assert the resulting state — not just a 200.
- **Contract tests** where the slice crosses a boundary: SAP adapter (**standalone | s4 | ecc** cassettes), TS↔Python (Schemathesis), event payload versions.
- **AI evals** (promptfoo/DeepEval) with an **offline-parity** run (egress blocked, local model) if the slice touches AI.
- **Migration** applies cleanly forward, and old+new binaries coexist on the expand-phase schema.

**T6 · Review & harden** — `requesting-code-review` → `code-review` (+ `security-review` for auth/data/AI-write paths). Run the boundary check (`dependency-cruiser`) and the **correctness + AI-safety checklists** (§8). Handle `receiving-code-review` with rigor, not reflexive agreement.

**T7 · Verify-before-completion & commit** — `verification-before-completion` (run the commands, show the output — evidence before "done"), then commit the small green slice. Branch + PR via **github**; ensure CI is green.

---

## 4. Specialized sub-workflows

**Adding/altering a bounded context (module).** Scaffold the vertical slice from the generator → define its public-API port barrel + Zod contracts → its domain events (versioned) → schema-per-context + real FKs → dependency-cruiser rule that nothing imports its internals. Master Data is read via a **sync port**, never a copied table.

**A cross-module workflow (saga).** Model it as a Postgres-backed process manager (`saga_instance` + `saga_step` + idempotency), driven by pg-boss. Consistency-critical reads/`reserve()` are **synchronous ports**; workflow *progression* is **events**. Compensation only at the genuinely-distributed edges (SAP, remote-GPU sidecar).

**An AI capability (propose→approve→execute).** Register a tool in the registry (RBAC-scoped, **read + create-proposal only**). The agent emits a **structured, Zod-validated Proposal** → the **approval inbox** shows the exact payload + a before/after diff → on human approve, `execute` runs through the **owning module's port**, **re-validating CASL/RLS + invariants against the exact approved payload** inside the transaction, idempotently, with an audit row (model/prompt/tool/version/input-hash/approver). Numbers come from deterministic queries; document/RAG text is untrusted. Add an eval + a **deterministic negative test** that the execute path rejects a forged/expired/replayed/mismatched approval.

**A Python ML sidecar capability.** Add to `tabular-ml` (forecast/anomaly) or `docai` (extraction) — never a new container per feature. Contract = Zod→Pydantic generated + Schemathesis fuzz. Trigger via outbox→pg-boss (batch) or a thin sync REST call (**never hold a DB transaction across the call**). Output is a **data-only proposal**; low-confidence/money-bearing fields force human review. CPU-first (ONNX); GPU is for the LLM.

**A SAP sync entity.** Extend `SapPort` (S4/ECC adapters) + `SyncSource` (push where available, poll universal). Idempotent version-guarded upserts, value-hash echo-suppression, mapping quarantine/dead-letter, incremental reconciliation. **SAP calls degrade gracefully — never block a core transaction.** Add a recorded-cassette contract test for both s4 and ecc, and keep standalone green.

**A DB migration.** Expand/contract only. Add columns/tables (expand) → deploy → backfill → switch reads → drop (contract) in a later release. Test old+new binaries on the expand schema. Never a long lock on a hot table.

---

## 5. The universal daily rhythm

**Brainstorm → plan → write the test → build one slice → run it against a real Postgres + drive the flow → review → verify → commit.** Parallelize with subagents when work is independent (e.g. a SAP-adapter task, a saga, and an ML-sidecar contract can run in three contexts at once via `subagent-driven-development`). Use a git worktree (`using-git-worktrees`) for isolation on larger slices.

---

## 6. Prompt patterns (copy/paste)

- **Current docs:** "Use Context7 to get the current Drizzle `pgTable` + RLS policy API before writing this migration."
- **Test-first:** "Write the integration test (Testcontainers real Postgres) for reserving stock on an order — assert `available` decrements atomically and oversell is rejected — before implementing."
- **Exercise it:** "Spin up the dev stack, POST a sales order via the API, then assert the DB row, the `SalesOrderConfirmed` outbox event, and the audit entry all exist."
- **Invariant/property test:** "Property-test the number-range allocator under 100 concurrent allocations — assert zero gaps and zero duplicates."
- **AI-safety:** "Write the negative test proving the execute path rejects an AI proposal whose approval record is missing/expired/replayed, at both the CASL and RLS layers."
- **SAP matrix:** "Run the SAP adapter contract suite against the s4 and ecc cassettes and confirm standalone mode still passes."
- **RLS check:** "Assert a query with no `SET LOCAL app.user_id` returns zero rows, and that tenant A cannot read tenant B's orders."
- **Big design:** "This is a new bounded context — should we run a multi-agent design pass first?" *(ask before spending the tokens.)*

---

## 7. Quality gates — Definition of Done (backend)

A slice is **done** only when all pass:

- [ ] **Tests:** unit (Vitest/pytest) + **integration on real Postgres (Testcontainers)** + contract (SAP s4/ecc + TS↔Python) + E2E for the flow; **property tests** on any money/stock/number-range logic
- [ ] **Correctness invariants held:** stock never negative (unless allowed), reserved ≤ on-hand, number ranges gapless where required, Money is decimal not float
- [ ] **AI-safety invariants upheld** (if AI touched): zero AI write scope, numbers-from-queries, execute-time re-validation, untrusted content, egress+cost gated — with a deterministic approval-bypass negative test
- [ ] **RLS fail-closed** tested: context-less query → 0 rows; cross-tenant isolation → denied
- [ ] **Both toggles green:** standalone + SAP-connected; cloud + local-AI (offline-parity eval if AI)
- [ ] **Migration:** expand/contract, reversible, old+new binaries coexist, no long locks
- [ ] **Boundaries clean:** `dependency-cruiser` passes; AI-Governance writes nothing directly; module talks only via ports/events
- [ ] **Observability:** structured logs + OTel trace with `correlationId`; **audit row written in the same transaction**; token/cost counted if AI
- [ ] **Idempotent:** handler safe under at-least-once redelivery
- [ ] **Reviewed:** `code-review` (+ `security-review` for auth/data/AI paths) clean; `verification-before-completion` run with real command output
- [ ] **Versions current:** APIs match pinned versions (Context7-checked)

---

## 8. Appendix

### Layered module structure (per bounded context)
`api/` (ts-rest/nestjs-zod controller + DTOs) → `application/` (use-cases, orchestration) → `domain/` (entities, value objects, invariants) → `infra/` (Drizzle repositories, adapters). `domain/` never imports `infra/`. The only public surface is the module's `index.ts` port barrel.

### The correctness checklist (money/stock/documents)
- Reservation is **atomic in-transaction** (`UPDATE … WHERE qty ≥ x` / row lock), never an async round-trip.
- Optimistic-lock version compared at write/execute; conflict → 409/re-queue, never silent overwrite.
- Number allocated as the **last statement before commit**; gapless series documented vs merely-unique.
- Money = `NUMERIC` + decimal.js with explicit rounding; currency code always carried.
- Every mutation writes its **audit row in the same transaction**.

### The five AI-safety invariants (from the spec §3.1)
1. **Zero AI write scope** — `ai_ro` read-only role + a single `create-proposal` capability; no domain writes, ever.
2. **Numbers only from deterministic, RLS-scoped queries** — never the LLM or embeddings; RAG is retrieval-only.
3. **Execute-time re-validation** — the exact approved payload, re-checking CASL/RLS/invariants + version guard inside the execute transaction; stale → fail, not force-apply; idempotent.
4. **Untrusted content** — document/email/RAG text is data, delimited, never instructions; can't expand the tool allowlist; low-confidence/money fields → human review.
5. **Structural egress + cost control** — `DATA_EGRESS=deny` refuses to construct a cloud client (+ VM firewall); hard token/cost/step budgets; breach = block + alert + audit.

### Config / feature-flag matrix (sourced from the signed license)
`INTEGRATION_MODE` (standalone|sap) · `DATA_EGRESS` (allow|deny) · `AI_COMPUTE` (cpu|gpu) · `RLS_ENFORCE` posture (single-tenant-default vs strict multi-tenant scoping — RLS is always active/fail-closed) · module entitlements · seat caps. Flags flip provider targets/adapters, never fork business logic.

### Version pins
Recorded in `pnpm` catalogs (one version per shared dep) and the Python lockfile. Re-verify with **Context7** at scaffold and after any bump. The spec §4 lists the current-verified set (NestJS 11, Drizzle 0.45.x, Postgres 18 + pgvector, pg-boss 12, Keycloak 26, Vercel AI SDK v7, FastAPI 0.136, etc.).

### Notes on our setup
- **github** MCP needs one-time OAuth (`/mcp` → github → Authenticate) before ship steps.
- Safe read-only dev commands are allowlisted in `.claude/settings.json`; write/destructive commands prompt for approval by design.

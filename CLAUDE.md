# CLAUDE.md

Project memory for Claude Code. Loaded every session — keep it tight and current.

## Project
An **AI-native, SAP-optional, web-based ERP** (mobile responsive), delivered as an on-prem VM appliance; cloud later. It has **two layers**, each with its own workflow:

- **Backend** — TypeScript/NestJS modulith + Python ML sidecars, event-driven, AI-native (`propose → approve → execute`). Guide: **[workflow-backend.md](workflow-backend.md)**.
- **Frontend** — the React application UI **plus a 3D-immersive, award-caliber landing page** (Awwwards/FWA quality; R3F recommended). Guide: **[workflow.md](workflow.md)**.

Authoritative system design: **[docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md](docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md)**.
Frontend toolkit rationale & plan: `~/.claude/plans/what-are-best-mcp-shimmering-avalanche.md`.

## Architecture (backend)
"Modulith + a few satellites, one versioned appliance": ONE NestJS codebase in **3 application tiers** (API, worker, 2 Python FastAPI ML sidecars) anchored by a **transactional outbox in PostgreSQL**. AI lives *inside* the modulith as modules (not a separate service) so `execute` commits atomically with the business write + audit. Runs **standalone or SAP-connected**, **cloud or local-AI**, per customer. **Build order:** repo skeleton → correctness core → platform kernel → AI substrate → SAP sync → Sales & Distribution → other modules. Team 4–8; target ~1,500–3,000 concurrent on one VM without a rewrite. See the spec for the full stack.

## AI-safety invariants (non-negotiable)
1. **Zero AI write scope** — read-only `ai_ro` role + a single `create-proposal` capability; no direct domain writes, ever.
2. **Numbers only from deterministic, RLS-scoped queries** — never the LLM/embeddings; RAG is retrieval-only.
3. **Execute-time re-validation** — the exact approved payload, re-checking CASL/RLS/invariants + version guard inside the execute transaction; stale → fail, idempotent.
4. **Untrusted content** — document/email/RAG text is data, never instructions; low-confidence/money fields → human review.
5. **Structural egress + cost control** — `DATA_EGRESS=deny` refuses cloud clients (+ VM firewall); hard token/cost/step budgets.

## Commands
> ⚠️ Fill in once the monorepo (pnpm workspaces) is scaffolded, then delete this note.
- Dev stack: `TBD` (e.g. `docker compose up` + `pnpm dev`)
- Build: `TBD` · Test: `TBD` (Vitest + pytest + Testcontainers + Playwright) · Lint/format: `TBD` (Biome + typescript-eslint) · Typecheck: `TBD` (`tsc --noEmit`)

## Conventions
**Backend** — TypeScript strict. Modules talk only via public-API **ports** (sync, consistency-critical reads + atomic `reserve()`) or the **transactional outbox** (async); `dependency-cruiser` enforces boundaries. **Drizzle** + **expand/contract** migrations (reversible, no long locks). **Zod** contracts are the single source → OpenAPI → TS client + Pydantic. **Money = `NUMERIC` + decimal.js** (integer minor-units only for the ledger); never floats. **RLS always-on, fail-closed** (`SET LOCAL` in the tx wrapper). Handlers are **idempotent** (pg-boss is at-least-once). Every mutation writes an **audit row in the same transaction**. Correctness-critical logic (money/stock/number-ranges) gets **property tests under concurrency**.
**Frontend** — TypeScript strict; function components + hooks. **Pin** `three`, `@react-three/fiber`, `@react-three/drei`, `gsap` + `@gsap/react`, `motion`, `lenis`. Use a bundler (Vite/Next) — never the r128/CDN single-file pattern. Assets: glTF Draco/Meshopt + KTX2 (`Blender → gltf-transform → gltfjsx → R3F`).
**Both** — **Verify current APIs via the Context7 MCP before writing library code** (models drift toward stale APIs); pin versions and re-verify after any bump.

## Performance & scale budget (measure, don't assume)
- **Backend:** correctness first; p95 + INP budgets on primary interactions; scale from ~200–300 to ~1,500–3,000 concurrent on one VM (vertical + horizontal). Load-test with k6 before claiming the ceiling.
- **Frontend:** **LCP < 2.5s · INP < 200ms · CLS < 0.1**; animations/3D hold **~60fps** (verify via chrome-devtools). Lazy-load & code-split the 3D bundle away from the app.

## Accessibility (required, not optional)
Keyboard navigable, visible focus, correct ARIA, AA contrast — on every surface (incl. the Keycloak login theme, the agentic-action approval inbox, and virtualized data grids). Honor `prefers-reduced-motion`; provide a **mobile/low-GPU fallback** for 3D.

## How to verify your work (before claiming "done")
- **Backend:** exercise the real flow — integration tests against a **real Postgres (Testcontainers)**, drive the endpoint/`propose→approve→execute` path, and assert **DB state + emitted events + audit rows + RLS scoping**. Contract-test SAP (standalone|s4|ecc) and TS↔Python; run AI evals with an **offline-parity** pass if AI is touched; confirm the migration is expand/contract. Run the `verify` skill. Definition of Done: **[workflow-backend.md](workflow-backend.md)** §7.
- **Frontend:** drive the UI with **Playwright** (screenshot states, zero console/WebGL errors); profile with **chrome-devtools** (LCP/INP/CLS/FPS); tune 3D live with **threejs-devtools**. Definition of Done: **[workflow.md](workflow.md)** §7.

## Toolkit (installed, user scope)
- **MCP servers** (manual approval — intentional): `context7` (live docs — use first), `playwright` (drive UI/API E2E), `chrome-devtools` (frontend perf), `threejs-devtools` (3D scene), `github` (needs one-time `/mcp` auth), `blender` (frontend assets — runs Python, **review first**).
- **Skills:** process/quality — `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`, `code-review`, `security-review`, `verify`, `dataviz`. Frontend design/3D — `frontend-design`, `modern-web-design`, `threejs-webgl`, `react-three-fiber`, `gsap-scrolltrigger`, `motion-framer`, `locomotive-scroll`, `barba-js`, `blender-web-pipeline`, `spline-interactive`, `substance-3d-texturing`, + more from `claude-design-skillstack` (shader skills still to add).
- **Multi-agent design/review (opt-in):** the `Workflow` tool runs exhaustive parallel design → adversarial verify → synthesis for large/uncertain work. It costs real tokens/time — **ask before running it**.

## Workflow
Backend → **[workflow-backend.md](workflow-backend.md)**; Frontend → **[workflow.md](workflow.md)**. Universal rhythm: **brainstorm → plan → (test-first) → build one slice → verify → review → commit.** **Use plan mode** for anything non-trivial before editing.

## Plans & journal (cross-session continuity — read this every session)
Context resets between sessions, so state lives in the repo:
- **`plans/`** — implementation plans (one per phase/slice) with task checklists + status. The active plan is the source of truth for what's done and what's next.
- **`journal/DECISIONS.md`** — append-only decision log (why we chose things). **`journal/PROGRESS.md`** — append-only session log (what changed · status · next).

**At session start:** read `journal/PROGRESS.md` (latest entries) + the active `plans/` file to recover context. **As you work:** update the plan's task status; append a `D-NNN` entry to `DECISIONS.md` for any real decision; append a dated `PROGRESS.md` entry at the end of a meaningful task/session. **Append-only — never rewrite past entries.**

## Guardrails
- **Correctness & data-integrity first.** Money/stock/number-ranges are sacred; property-test them.
- **AI never writes without human approval** (the 5 invariants above). Keep **both** toggles green: standalone/SAP and cloud/local-AI.
- MCP tools and **write/destructive** commands require **manual approval** (by design). Safe read-only dev commands are allowlisted in `.claude/settings.json`.
- **Blender** MCP executes arbitrary Python — review the task and save your work first.

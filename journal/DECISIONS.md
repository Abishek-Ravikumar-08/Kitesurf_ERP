# Decision Log (ADR-lite)

Append-only; newest at the bottom. Format:
`D-NNN · date · decision — rationale (alternatives rejected). [spec ref]`

- **D-001 · 2026-07-16 · Architecture = modular monolith ("modulith") + a few satellites, one versioned appliance.** Rejected full microservices — a 4–8 dev team can't operate them across customer VMs; the adversarial design review repeatedly pruned toward this. [spec §2]
- **D-002 · 2026-07-16 · Backend = TypeScript/NestJS core + Python FastAPI ML sidecars.** One language for ~95% of the app + end-to-end typed contracts; Python only where ML libraries genuinely require it. [spec §1, §4]
- **D-003 · 2026-07-16 · AI is a first-class *internal* plane (not a separate service); autonomy = propose→approve→execute with zero AI write scope.** Keeps `execute` atomic with the business write + audit. Multi-provider (Claude / OpenAI / local) chosen per customer via the `DATA_EGRESS` gate. The five AI-safety invariants are law. [spec §3]
- **D-004 · 2026-07-16 · Data + async = PostgreSQL 18 + pgvector + Drizzle + transactional outbox + pg-boss. No Restate/Temporal/Kafka/Redis at v1.** One durability model, one backup story; long-running/human-gated flows are Postgres-backed sagas. [spec §4, §9.2]
- **D-005 · 2026-07-16 · Realtime = Socket.IO in-process, outbox reconcile-on-connect; Valkey (cache + pub/sub) only when multi-node.** [spec §4, §9.5]
- **D-006 · 2026-07-16 · Auth = Keycloak (OIDC/SAML + AD/LDAP) + CASL + PostgreSQL RLS, always-on and fail-closed; `ai_ro` read-only role for AI.** [spec §9.4]
- **D-007 · 2026-07-16 · Frontend = static-export marketing + Vite React SPA; ECharts (one lib); Money = NUMERIC + decimal.js (integer minor-units only for the ledger).** Award-caliber 3D landing scope decided at the marketing-page phase. [spec §6, §9.5]
- **D-008 · 2026-07-16 · Delivery = prebuilt Hyper-V/VMware Linux VM appliance; plain Docker Compose + an admin-triggered appliance-agent doing cosign-signed blue/green updates over the customer VPN.** Rejected Docker Swarm / k3s on a single box. [spec §9.8]
- **D-009 · 2026-07-16 · SAP is optional behind an ACL port; the adapter flexes S/4HANA + ECC; sync supports push + poll; SAP owns master data + number ranges when connected.** `node-rfc` dropped (archived / non-redistributable). [spec §9.3]
- **D-010 · 2026-07-16 · Build order = repo skeleton → correctness core → platform kernel → AI substrate → SAP sync → Sales & Distribution (first module) → the rest.** Correctness core first because retrofitting reservation/ATP, optimistic locking, and gapless number ranges is the rewrite we're avoiding. [spec §6, §7, §10]
- **D-011 · 2026-07-16 · Version control = git on `main`, connected to GitHub `Abishek-Ravikumar-08/Kitesurf_ERP`.** Initial commit `685a23f` (design docs + workflows + CLAUDE.md).
- **D-012 · 2026-07-16 · Cross-session continuity via in-repo `plans/` + append-only `journal/`, kept current as a standing workflow step recorded in CLAUDE.md.** Chosen over a hook-only approach because hooks can stamp events but can't summarize decisions.

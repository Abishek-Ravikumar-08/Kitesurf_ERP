# Frontend Design Workflow — Best-in-Class

> A repeatable, tool-driven workflow for building the frontend of this web application:
> **(A) the landing page** and **(B) interactive application modules & pages**.
> It maps every MCP server and skill we've installed to the exact step where it earns its place.
>
> Companion doc: the toolkit rationale + build plan lives in the plan file
> (`~/.claude/plans/what-are-best-mcp-shimmering-avalanche.md`).

---

## 0. The one idea that makes this "best in class"

**Never let the agent build blind.** Every visual or interactive change runs through a closed loop:

```
        ┌──────────────────────────────────────────────┐
        ▼                                                │
   BUILD a small slice ─▶ OBSERVE (Playwright screenshot,│
   (skills author code)   console/WebGL errors)          │
        │                        │                       │
        ▼                        ▼                       │
   MEASURE (chrome-devtools     TUNE (threejs-devtools    │
   perf trace, CWV, FPS)         live scene/materials) ───┘
        │
        ▼
   REVIEW ▶ VERIFY ▶ COMMIT
```

Claude can **see** the render (Playwright), **measure** the cost (Chrome DevTools), and **tune**
the 3D scene live (Three.js DevTools). That feedback loop is the difference between a polished,
performant result and a pretty-but-janky demo.

### Golden rules (apply to every task)
1. **Context7 first.** Before writing library code, pull current docs via Context7 — Three.js/R3F/GSAP/Next APIs drift and stale code is the #1 failure mode.
2. **Pin versions.** Use a bundler (Vite/Next) with pinned Three.js/R3F/GSAP. Never ship the r128/CDN single-file pattern some starter skills default to.
3. **Budget performance up front.** Every screen has an LCP/INP/CLS + FPS budget (see §8). Measure, don't guess.
4. **Design for everyone.** `prefers-reduced-motion`, keyboard access, and a mobile/low-GPU fallback are requirements, not extras.
5. **Manual approval is on.** Every MCP tool call prompts you — approve deliberately; don't blanket "don't ask again."
6. **Small, verified slices.** Build one section/component, run the loop, commit. Repeat.

---

## 1. Our toolkit (quick reference)

### MCP servers
| Server | Use it to… | Phase |
|---|---|---|
| **context7** | Fetch current docs for any library (Three.js, drei, GSAP, Next, Tailwind, Motion) | All build phases |
| **playwright** | Drive the UI: navigate, click, type, screenshot states, catch console/WebGL errors | Verify loop |
| **chrome-devtools** | Record performance traces, read Core Web Vitals (LCP/INP/CLS), FPS, network, memory | Verify + polish |
| **threejs-devtools** | Inspect/edit a *running* 3D scene — objects, materials, shaders, lights, draw calls, memory | 3D build/tune |
| **github** | Repos, branches, PRs, issues, Actions *(needs one-time `/mcp` auth)* | Plan + ship |
| **blender** | Author/modify 3D assets; pull Poly Haven textures/HDRIs; Hyper3D AI meshes *(needs addon; runs Python — review first)* | Asset pipeline |

### Skills (auto-trigger by task description)
| Group | Skills | When they fire |
|---|---|---|
| **Process** | `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion` | Throughout — HOW we work |
| **Art direction** | `frontend-design` (official), `modern-web-design` | Concept, design system, polish |
| **Core 3D** | `threejs-webgl`, `react-three-fiber`, `babylonjs-engine` | Building 3D scenes |
| **Motion/scroll** | `gsap-scrolltrigger`, `motion-framer`, `locomotive-scroll`, `scroll-reveal-libraries`, `react-spring-physics` | Animation & scroll |
| **Transitions** | `barba-js` | Page/route transitions |
| **Asset authoring** | `blender-web-pipeline`, `substance-3d-texturing`, `spline-interactive` | glTF pipeline, textures, no-code 3D |
| **2D / micro-visuals** | `pixijs-2d`, `lottie-animations`, `animejs`, `lightweight-3d-effects`, `rive-interactive` | Icons, particles, decorative effects |
| **Components** | `animated-component-libraries` | Prebuilt animated React components |
| **Integration meta** | `web3d-integration-patterns` | Combining 3D + GSAP + R3F at scale |
| **Quality** | `code-review`, `security-review`, `verify`, `dataviz`, `artifact-design` | Review, data viz, prototypes |

> **Gap to close:** dedicated shader skills (`threejs-shaders`, `shader-programming-glsl`) aren't
> installed yet. Add them before heavy GLSL/particle work. Until then, `threejs-webgl` + Context7 cover basics.

---

## 2. Shared foundation (do once, then reuse)

**Phase 0 — Project setup.** Scaffold Vite or Next + TypeScript. Install pinned Three.js / `@react-three/fiber` / `@react-three/drei` / `gsap` / `@gsap/react` / `motion` / `lenis`. Add ESLint + Prettier (or Biome), a test runner (Vitest + Playwright), and a Lighthouse/CWV check in CI. Write a `CLAUDE.md` capturing: pinned versions, the per-screen perf budget, asset conventions (Draco/Meshopt + KTX2), and the a11y/reduced-motion rule. Commit `.mcp.json` so the team inherits the servers.

**Phase 1 — Design language (once for the whole app).** Run `frontend-design` + `modern-web-design` to lock: type scale, color system + tokens, spacing, motion language (easing curves, durations), and the interaction vocabulary. This becomes the shared design system every page and module draws from — it's what keeps the landing page and the app feeling like one product.

---

## 3. Workflow A — Landing page

Goal: a striking, fast, conversion-focused entry point. Spectacle is welcome — *but it must load fast and degrade gracefully.*

**A1 · Concept & story** — `brainstorming` → nail the narrative, the single "hero moment," the scroll journey, and the conversion goal (what should the visitor *do*?). Output: a one-page brief + a storyboard of scroll sections.

**A2 · Art direction** — `frontend-design` + `modern-web-design` → translate the brief into concrete visuals: hero treatment, palette, typography, motion feel. Decide the hero medium: **interactive 3D** (Three.js/R3F), **no-code 3D** (`spline-interactive`), **lightweight pseudo-3D** (`lightweight-3d-effects`), or **AI/cinematic video** (optional Higgsfield). Pick the lightest option that lands the impact.

**A3 · Plan** — `writing-plans` → section list, the scroll choreography, an asset list, and a **per-section perf budget**. Commit the framework choice (R3F recommended if the wider app is React).

**A4 · Assets** (only if custom 3D) — `blender` MCP + `blender-web-pipeline` skill to model/fetch → optimize with `gltf-transform` (Draco/Meshopt geometry, KTX2 textures) → convert to an R3F component. `substance-3d-texturing` for PBR materials. Keep the hero mesh within the triangle/texture budget from A3.

**A5 · Build, section by section** — with **Context7** keeping APIs current:
- Hero 3D: `react-three-fiber` / `threejs-webgl`; tune live with **threejs-devtools**.
- Scroll story: `gsap-scrolltrigger` (pin/scrub/parallax, camera & material tweens on scroll) + `locomotive-scroll`/Lenis for smooth scroll.
- UI reveals & micro-interactions: `motion-framer`; simple fades: `scroll-reveal-libraries`.
- Section-to-section or route transitions: `barba-js`.
- Decorative accents: `lottie-animations`, `pixijs-2d` particles, `animejs`.
- Multi-library orchestration: `web3d-integration-patterns`.

**A6 · Verify loop (every section)** —
- **Playwright:** screenshot each scroll state, assert no console/WebGL errors, confirm the hero and CTA render.
- **chrome-devtools:** record a performance trace → check **LCP, CLS, INP, long tasks, FPS** during scroll; inspect the network waterfall for oversized assets.
- **threejs-devtools:** read draw calls / triangles / memory; apply instancing, LOD, frustum culling, merged geometry until it holds ~60fps.
- *Do not advance to the next section until the current one passes its budget.*

**A7 · Polish for launch** — intentional loader/progress; `prefers-reduced-motion` path + mobile/low-GPU fallback (static hero or reduced scene); lazy-load and code-split the 3D bundle; final Lighthouse/CWV pass; cross-browser check.

**A8 · Ship** — `requesting-code-review` → `code-review` → `verification-before-completion`; branch + PR via **github**; deploy; if it's award-bound, submit to Awwwards/FWA.

---

## 4. Workflow B — Interactive application modules & pages

Goal: dashboards, forms, data views, settings, feature modules. Here **usability, state correctness, and responsive feedback beat spectacle.** Motion communicates (state changes, transitions, affordances) rather than decorates.

**B1 · Job-to-be-done** — `brainstorming` → the module's purpose, the primary user flows, the data it reads/writes, and the states it must handle (empty / loading / error / success / partial).

**B2 · Design from the system** — `frontend-design` + `modern-web-design` → compose from the shared design system (§2, Phase 1). Define the component tree, every interactive state, focus order, and responsive behavior *before* coding.

**B3 · Plan** — `writing-plans` → component breakdown, state/data model, routes, API contracts, and interaction spec (what each gesture/keypress does).

**B4 · Build components (test-first)** — `test-driven-development` → write the behavior test, then implement. Use:
- `animated-component-libraries` for polished prebuilt pieces (don't hand-roll what exists).
- `motion-framer` for interaction feedback: layout animations, `AnimatePresence` exits, hover/tap/drag, spring transitions.
- `react-spring-physics` where natural, physics-based motion matters (drag, inertia, sheets).
- `rive-interactive` / `lottie-animations` for stateful animated icons and loaders.
- `dataviz` for charts/analytics; `pixijs-2d` for high-density canvas visuals or overlays.
- **Context7** for current React/Next/library APIs and patterns.

**B5 · Wire state & data** — forms with validation and optimistic UI; loading/error/empty states from B1; route transitions with `barba-js` (or the framework router). Motion is *feedback*: confirm an action, reveal a result, guide attention — never gratuitous.

**B6 · Verify loop (every module)** —
- **Playwright:** drive the real flow — click, type, submit, navigate — and assert each resulting state (validation errors, success, data render). This is your E2E safety net.
- **chrome-devtools:** measure **INP** (interaction latency), long tasks, and memory; profile re-renders on heavy interactions (typing, dragging, filtering).
- **Accessibility pass:** keyboard-only walkthrough, visible focus, ARIA roles/labels, contrast, and the `prefers-reduced-motion` variant.

**B7 · Review & harden** — `code-review` + `security-review` (inputs, auth, data handling) + `verification-before-completion`. Confirm every state from B1 is handled.

**B8 · Ship** — branch + PR via **github**; ensure CI (tests + Lighthouse) is green.

---

## 5. The universal daily rhythm

Regardless of track: **brainstorm → plan → build one slice → Playwright screenshot + DevTools measure → fix → review → verify → commit.** Parallelize with subagents when work is independent (e.g. a shader problem, a perf pass, and a motion sequence can run in three contexts at once via `subagent-driven-development`).

---

## 6. Prompt patterns (copy/paste)

Concrete asks that trigger the right tool/skill:

- **Current docs:** "Use Context7 to get the current `@react-three/drei` API for `<ScrollControls>` before writing this."
- **See it:** "Open the landing page with Playwright, screenshot the hero and the pricing section, and report any console or WebGL errors."
- **Measure it:** "Record a Chrome DevTools performance trace of a full scroll-through and report LCP, CLS, INP, and any long tasks over 50ms."
- **Tune the scene:** "Using Three.js DevTools, list draw calls and triangle count in the current scene and suggest what to instance or cull to hit 60fps."
- **Author an asset:** "In Blender, create a low-poly [object], fetch a studio HDRI from Poly Haven, then export an optimized glTF (Draco + KTX2) for R3F." *(Review before running — Blender executes Python.)*
- **Interaction test:** "With Playwright, fill the signup form with an invalid email, submit, and assert the inline validation error appears and focus moves to the field."
- **A11y check:** "Walk the settings page keyboard-only via Playwright; verify focus order and that the reduced-motion variant disables the transitions."

---

## 7. Quality gates — Definition of Done

A screen/module is **done** only when all pass:

- [ ] **Performance:** LCP < 2.5s · INP < 200ms · CLS < 0.1 · animations/3D hold ~60fps (verified via chrome-devtools, not assumed)
- [ ] **No errors:** zero console/WebGL errors in Playwright across all states
- [ ] **Responsive:** works from mobile → desktop; 3D has a low-GPU/mobile fallback
- [ ] **Accessible:** keyboard-navigable, visible focus, ARIA correct, contrast AA, `prefers-reduced-motion` honored
- [ ] **Assets optimized:** glTF Draco/Meshopt + KTX2; images sized/lazy; 3D bundle code-split
- [ ] **Tested:** Playwright covers the primary flow(s); TDD units for logic
- [ ] **Reviewed:** `code-review` (+ `security-review` for app modules) clean; `verification-before-completion` run
- [ ] **Versions current:** library APIs match installed pinned versions (Context7-checked)

---

## 8. Appendix

### Performance budget (starting point — tighten per screen)
- Landing hero: ≤ ~150k triangles visible, ≤ ~100 draw calls, textures ≤ ~30MB GPU, first meaningful paint fast via lazy 3D.
- App modules: INP < 200ms on primary interactions; avoid layout thrash; virtualize long lists.

### Asset pipeline (custom 3D)
`Blender` (model / Poly Haven / Hyper3D) → `gltf-transform` (Draco or Meshopt geometry + KTX2/Basis textures) → `gltfjsx` → R3F component. Keep source `.blend` and exported `.glb` under version control-friendly paths.

### Pinned versions (record actual values in CLAUDE.md)
`three`, `@react-three/fiber`, `@react-three/drei`, `gsap` + `@gsap/react`, `motion`, `lenis`. Update deliberately; re-verify with Context7 after any bump.

### Notes on our setup
- **github** MCP needs a one-time OAuth (`/mcp` → github → Authenticate) before B8/A8 steps use it.
- **blender** MCP needs its addon installed + "Connect to Claude" in Blender, and executes Python — review tasks and save first.
- Trim context anytime with `claude plugin disable <name>@claude-design-skillstack` for skills you're not using on a given screen.

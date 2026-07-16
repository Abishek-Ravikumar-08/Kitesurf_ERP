# Plans

Implementation plans for the **Kitesurf ERP**, one file per phase or major slice.
Designed to **survive across sessions** — when a new session starts and context resets,
the active plan here is the source of truth for *what's done* and *what's next*.

- Authoritative **design**: [`../docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md`](../docs/superpowers/specs/2026-07-16-erp-ai-native-system-design.md)
- This folder is the **execution** of that design. The **journal** ([`../journal/`](../journal/)) records the timeline + rationale.

## How plans work
- One file per phase/slice: `phase-NN-<slug>.md` (e.g. `phase-01-skeleton.md`), or `<area>-<slug>.md` for sub-plans. Start from [`TEMPLATE.md`](TEMPLATE.md).
- Each plan has a **status header** and a **task checklist** with acceptance criteria.
- **Update task status as you go** (check the box + set the status). At session end, note where you stopped in the plan's Progress log **and** in [`../journal/PROGRESS.md`](../journal/PROGRESS.md).
- Each plan cross-references the spec section it implements, and links from the index below.

## Status legend
🔲 not started · 🔄 in progress · ✅ done · ⏸️ blocked · ❌ dropped

## Index
| Plan | Implements (spec §) | Status | Updated |
|------|---------------------|--------|---------|
| _(none yet — Phase 1 is next)_ | | | |

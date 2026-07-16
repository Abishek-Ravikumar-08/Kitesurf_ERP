# Journal

The project's **decision log** and **progress journal** — version-controlled and team-visible.
This is how we keep continuity across sessions and remember *why* we chose things, so future
decisions stay consistent.

Two running, **append-only** files:
- **[DECISIONS.md](DECISIONS.md)** — durable decisions with rationale (ADR-lite): "we chose X over Y because Z."
- **[PROGRESS.md](PROGRESS.md)** — dated session log: what changed, current status, next step.

## Relationship to the other docs
- **Specs** (`docs/superpowers/specs/`) = the *what/how* of the design (living documents).
- **Plans** (`plans/`) = the *execution* checklist per phase.
- **Journal** (here) = the *timeline + rationale* — append-only history you never rewrite.
- Claude's own cross-session memory lives **outside** the repo (`~/.claude/.../memory/`); this journal is the in-repo, team-shared counterpart.

## How it stays current
Updating the journal is a **standing step in the workflow** (see `CLAUDE.md`):
- **At session start** — read PROGRESS.md (latest entries) + skim DECISIONS.md to recover context.
- **When a decision is made** — append a `D-NNN` entry to DECISIONS.md.
- **At the end of a meaningful task / session** — append a dated entry to PROGRESS.md, and update the active `plans/` task status.

> **On "automatic":** this is workflow-driven (done by Claude every session), not a background process. A harness hook can stamp session boundaries but can't summarize decisions — that's why the substance lives here and is written deliberately. **Append-only:** never rewrite past entries; correct with a new one.

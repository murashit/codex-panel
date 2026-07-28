This repository contains the Codex Panel Obsidian plugin.

## Working Principles

- Start from evidence. Reproduce defects before fixing them, using the cheapest deterministic layer that exercises the suspected cause. A reliable automated reproduction is sufficient unless material environment-specific behavior remains outside that test. For product changes, reconstruct the current workflow, user need, alternatives, and losses before deciding what should change. Treat theoretical failure modes and reviewer agreement as hypotheses, not evidence of meaningful user or operational harm.
- Use design documents as context, not as a substitute for current behavior and user expectations. Prefer coherent user-facing behavior and clear ownership, and remove needless abstraction or obsolete compatibility instead of preserving it by default.
- Treat implementation, tests, documentation, lint policy, and final history as one deliverable: inspect each for drift, but update only the durable contracts that changed. Documentation should record user-facing behavior, long-term design, or reusable workflow; do not add it merely to narrate an implementation change or duplicate tests and tooling. If a detail is readily derivable from current code and likely to drift, leave it in code or tests instead. Stale or speculative documentation is a defect with operational cost: correct or remove it when it is within the task's scope, but do not create new documentation solely because an implementation changed without altering a durable contract.
- Treat review findings as evidence about the design, not as a patch list. Before editing, identify the violated invariant and its owning boundary; when multiple findings share a cause or expose misplaced ownership, reconsider the design and replace the local patch rather than stacking compensating fixes. Keep a local fix only when the cause and consequences are genuinely local.
- Parallelize only substantial concerns that can be implemented and tested independently with little shared-file contention. Keep small, tightly coupled, sequential, or coordination-heavy work together.

## What To Read

- Read `README.md` for user-facing behavior, requirements, commands, privacy, and compatibility.
- Read `docs/design.md` when changing responsibility boundaries, runtime ownership, app-server source-of-truth behavior, UI ownership, or testing philosophy.
- Read `docs/development.md` before implementation work, generated binding work, source layout decisions, validation, or compatibility baseline changes.
- Read `docs/release.md` for release preparation, release notes, preflight, tagging, pushing, and release repair.
- Use the repo-local skills in `.agents/skills/` when a task matches a more specific workflow.

## Changes And Validation

- Jujutsu is the recommended local change-management workflow when available. Make each final change a coherent review unit with an honest description.
- Before publishing, inspect and reorganize the graph when needed rather than preserving implementation chronology: normally fold corrective follow-ups into the concern they complete, split mixed changes, and keep a follow-up separate only when it remains meaningful on its own.
- Use Conventional Commits for new commits and follow `docs/development.md` for repository rules and validation. Re-run relevant validation after history edits and before handoff or publication.

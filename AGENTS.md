This repository contains the Codex Panel Obsidian plugin.

## Working Principles

- Start from evidence. Reproduce defects before fixing them; for product changes, reconstruct the current workflow, user need, alternatives, and losses before deciding what should change.
- Use design documents as context, not as a substitute for current behavior and user expectations. Prefer coherent user-facing behavior and clear ownership, and remove needless abstraction or obsolete compatibility instead of preserving it by default.
- Treat implementation, tests, documentation, lint policy, and final history as one deliverable. Update any drift in the same change and report it.
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

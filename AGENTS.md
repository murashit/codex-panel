This repository contains the Codex Panel Obsidian plugin.

## Working Principles

- Ground decisions in current behavior, user needs, and authoritative boundary contracts. Treat documentation, tests, theory, and reviewer agreement as inputs—not substitutes—for evidence.
- Prefer the smallest coherent user-facing model with clear semantic ownership over preserving existing work. Treat review findings and edge cases as reasons to reopen the design, and make them ordinary consequences of the model rather than exceptions preserved by compensating patches.
- Keep the Panel thin. Remove needless abstraction, duplicated ownership, and obsolete compatibility instead of preserving them through local complexity.
- Treat implementation, tests, documentation, policy, and final history as one reviewable deliverable, and keep only artifacts that express durable behavior or constraints.

## What To Read

- Read `README.md` for user-facing behavior, requirements, commands, privacy, and compatibility.
- Read `docs/design.md` when changing responsibility boundaries, runtime ownership, app-server source-of-truth behavior, UI ownership, or testing philosophy.
- Read `docs/development.md` before implementation work, generated binding work, source layout decisions, validation, or compatibility baseline changes.
- Read `docs/release.md` for release preparation, release notes, preflight, tagging, pushing, and release repair.
- Use the repo-local skills in `.agents/skills/` when a task matches a more specific workflow.

## Changes And Validation

- Reproduce defects at the cheapest deterministic layer that exercises the suspected cause. Use live Obsidian validation only when material integration behavior remains outside automation.
- Review changes in proportion to their scope and risk, covering both regression risk and design quality. Use a fresh read-only subagent only when independence materially improves confidence; otherwise use a direct second pass. Before acting on a finding, identify the violated invariant and owner, and record why material findings are addressed or rejected.
- After substantial implementation and review, finish the implementation change and use a fresh child for a dedicated simplification pass. Keep only refactoring that materially reduces ownership, indirection, branching, duplication, or code size while preserving behavior and clarity; otherwise leave no churn and report that no worthwhile simplification was found.
- Document durable user behavior, design, or reusable workflow—not implementation narration that is readily derived from code and likely to drift.
- Parallelize only substantial independent concerns with little shared-file contention; keep tightly coupled work together.
- Jujutsu is the recommended local change-management workflow when available. Make each final change a coherent review unit with an honest description.
- Before publishing, inspect and reorganize the graph when needed rather than preserving implementation chronology: normally fold corrective follow-ups into the concern they complete, split mixed changes, and keep a follow-up separate only when it remains meaningful on its own.
- Use Conventional Commits for new commits and follow `docs/development.md` for repository rules and validation. Re-run relevant validation after history edits and before handoff or publication.

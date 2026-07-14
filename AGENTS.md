This repository contains the Codex Panel Obsidian plugin.

Jujutsu is the recommended local change-management workflow when available.

Commits after the `5.0.0` tag must follow Conventional Commits. Use the repository's allowed types and examples in `docs/development.md`, and validate the relevant commit range explicitly because Jujutsu does not rely on local Git hooks.

## What To Read

- Read `README.md` for user-facing behavior, requirements, commands, privacy, and compatibility.
- Read `docs/design.md` when changing responsibility boundaries, runtime ownership, app-server source-of-truth behavior, UI ownership, or testing philosophy.
- Read `docs/development.md` before implementation work, generated binding work, source layout decisions, validation, or compatibility baseline changes.
- Read `docs/release.md` for release preparation, release notes, preflight, tagging, pushing, and release repair.
- Use the repo-local skills in `.agents/skills/` when a task matches a more specific workflow.

When implementation, design, or workflow changes create drift from docs or lint policy, update the affected docs or lint settings in the same change and report that update.

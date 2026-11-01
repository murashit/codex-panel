This repository contains the Codex Panel Obsidian plugin.

## Working Principles

Ground decisions in current behavior, user needs, and authoritative boundary contracts. Keep the Panel thin, with clear ownership and the simplest structure that meets the required behavior. Keep implementation, tests, documentation, and history consistent.

## What To Read

- [README](README.md): supported behavior, requirements, commands, privacy, and compatibility.
- [Design](docs/design.md): responsibility boundaries, runtime and UI ownership, and app-server contracts.
- [Development](docs/development.md): implementation, documentation, review, validation, compatibility, and commit/PR guidance. Follow its required checks before handoff.
- [Release](docs/release.md): release preparation, explicit user approval of final notes and contents, publication, and recovery.
- `.agents/skills/`: select applicable workflows by their descriptions and read them before the work they cover, including approval boundaries.

## Review Responsibilities

When design choices materially affect responsibility or dependency boundaries, shared state, or asynchronous lifetimes, involve an independent read-only design/simplification contributor before choosing the approach and again when implementation evidence changes it. Obtain final behavior, contract, and regression review from a fresh read-only subagent who did not participate in design or implementation. Reconsider independently when assumptions or design materially change.

Use a fresh read-only reviewer for substantive guidance or policy edits. Other changes can use a direct second pass unless independent review materially improves confidence.

The primary agent owns completion of the full requested outcome, resolves findings against evidence, and reports material unresolved questions or blockers.

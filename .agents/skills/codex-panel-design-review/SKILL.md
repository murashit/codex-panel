---
name: codex-panel-design-review
description: Review Codex Panel architecture repository-wide when explicitly requested. Excludes review of an individual change.
---

# Codex Panel Design Review

Assess the whole implementation for material behavioral and structural improvements using [Design](../../../docs/design.md), the [shared review criteria](../../../docs/development.md#review-and-simplify-a-change), and the [test criteria](../../../docs/development.md#write-tests-that-survive-refactoring). Implement findings only when the task includes changes.

## Establish coverage

Inventory authored product and test surfaces separately from generated code and artifacts. Trace principal flows through lifecycle, app-server adaptation, UI, persistence, build/generation, and policy tests. Assess tests and fixtures as design subjects as well as evidence. Keep a concise coverage ledger of reviewed flows, material failure/refresh paths, and gaps; local observations do not establish repository-wide conclusions.

During repository-wide simplification review, run and interpret the duplication report under [Investigate Duplication](../../../docs/development.md#investigate-duplication).

## Evaluate candidates

Establish a candidate's value before developing a detailed replacement: identify the supported behavior or maintenance cost, material consequence, and strongest keep-current case. Compare plausible improvements under [Choose the Owner of a Change](../../../docs/development.md#choose-the-owner-of-a-change), including guarantees already supplied by existing owners.

Have a fresh read-only subagent challenge material candidates' evidence, expected behavior, and value without seeding the conclusion. Have independent review also challenge material architecture judgments as replacements develop. If independent review for this repository-wide assessment is unavailable or disproportionate, record why and perform a separate second pass. This fallback does not waive AGENTS.md's mandatory reviews when implementing changes.

Accept improvements whose benefit justifies their complete ownership, state, coordination, UX, compatibility, and testing costs. Reject candidates with unsupported value; reserve unresolved status for material questions blocked by specific missing evidence. Reopen rejected candidates only for material new evidence.

## Deliver findings

Rank accepted findings by consequence and dependency order. Give exact sources, current cost, target design, impact, and remaining uncertainty. Explain important rejected candidates and unresolved questions, and summarize achieved coverage and gaps. A no-finding result is valid; do not present an unqualified pass while consequential questions remain unresolved.

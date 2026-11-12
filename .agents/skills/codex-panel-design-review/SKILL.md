---
name: codex-panel-design-review
description: Review Codex Panel architecture repository-wide when explicitly requested. Excludes review of an individual change.
---

# Codex Panel Design Review

Use [Design](../../../docs/design.md), the [review and test criteria](../../../docs/development.md#review-and-simplify-a-change), and [AGENTS.md](../../../AGENTS.md#review-and-completion). Implement findings only when the task includes changes.

## Establish coverage

Inventory authored product and test surfaces separately from generated code and artifacts. Trace principal flows through lifecycle, app-server adaptation, UI, persistence, build/generation, and policy tests. Keep a concise ledger of reviewed flows, consequential failure/refresh paths, and gaps. Assess tests and fixtures as design subjects as well as evidence.

Run and interpret the [duplication report](../../../docs/development.md#investigate-duplication). Establish each candidate's concrete benefit and strongest keep-current case before developing a replacement.

## Evaluate and report

Apply AGENTS.md's independent-review requirements to material candidates and architecture judgments.

Rank accepted findings by consequence and dependency order, with exact sources, current cost, proposed change, impact, and uncertainty. Explain important rejected candidates and blocked questions; reopen rejected candidates only for material new evidence. Report coverage and gaps. A no-finding result is valid, but unresolved consequential questions preclude an unqualified pass.

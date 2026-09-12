---
name: codex-panel-design-review
description: Review Codex Panel architecture repository-wide when explicitly requested. Excludes review of an individual change.
---

# Codex Panel Design Review

Assess the whole implementation for material behavioral and structural improvements. Use `docs/design.md` for Panel, Obsidian, and app-server ownership; supported user expectations and producing contracts take precedence over architectural preference. Implement findings only when the task includes changes.

## Coverage and evidence

Inventory authored product surfaces separately from generated code and artifacts. Trace principal flows through lifecycle, app-server adaptation, UI, persistence, build/generation, and policy tests. Keep a concise coverage ledger with material failure/refresh paths and gaps. Investigate candidates as evidence emerges while completing repository-wide coverage; a local observation does not establish a repository-wide conclusion.

Trace behavioral claims to real producers, user actions, or lifecycle paths, and structural claims to actual dependencies or maintenance activities. Check consequential external assumptions against their producing contracts, including authority, completeness, ordering, and failure semantics. Synthetic fixtures, unusual ordering, and reviewer agreement do not by themselves establish harm.

## Decide findings

Accept a finding only when it has:

- Concrete implementation evidence and a supported expectation or engineering activity at stake.
- A material present cost, constraint, or risk, with its consequence and recurrence explained.
- A concrete replacement that improves the whole model after accounting for added state, coordination, lifecycle, UX, compatibility, and testing costs.

Compare the strongest keep-current case with the proposed replacement through affected callers and contracts. Prefer the simplest coherent owner and end state; do not preserve material debt just to keep a fix local. Retain compatibility that belongs to the supported product.

Classify candidates as accepted, rejected with clearing evidence, or unresolved with specific missing evidence. Reopen rejected candidates only for material new evidence. Investigation depth should follow consequence and uncertainty, not an exhaustive enumeration of possible edge cases.

Use a fresh read-only subagent to challenge material architecture judgments, including the keep-current case. Supply raw paths, product constraints, and these acceptance criteria without seeding the conclusion. Resolve disagreements against evidence. If independent review is unavailable or disproportionate, record why and perform a separate second pass.

## Deliverable

Rank accepted findings by architectural consequence and dependency order. Give exact sources, current cost, target design, relevant impact, and remaining uncertainty. Summarize rejected candidates, unresolved material questions, and achieved coverage. A no-finding result is valid; qualify it by material coverage gaps. Do not turn speculative cleanup into findings or present an unqualified pass while a consequential question remains unresolved.

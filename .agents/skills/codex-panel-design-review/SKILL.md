---
name: codex-panel-design-review
description: Review Codex Panel architecture repository-wide when explicitly requested. Excludes review of an individual change.
---

# Codex Panel Design Review

Assess the whole implementation for material behavioral and structural improvements. Use `docs/design.md` for Panel, Obsidian, and app-server ownership; supported user expectations and producing contracts take precedence over architectural preference. Implement findings only when the task includes changes.

## Coverage and evidence

Inventory authored product and test surfaces separately from generated code and artifacts. Trace principal flows through lifecycle, app-server adaptation, UI, persistence, build/generation, and policy tests. Assess tests and fixtures as design subjects under the [shared review and simplification criteria](../../../docs/development.md#review-and-simplify-a-change) and [test criteria](../../../docs/development.md#write-tests-that-survive-refactoring), not only as evidence for product behavior. Keep a concise coverage ledger with material failure/refresh paths and gaps. Investigate candidates as evidence emerges while completing repository-wide coverage; a local observation does not establish a repository-wide conclusion.

During repository-wide simplification review, run `npm run review:duplication` and assess matches using [Investigate Duplication](../../../docs/development.md#investigate-duplication). Apply the same criteria to existing and new code; use the report as review information, following the linked scope, generated-code exclusion, and interpretation guidance.

Trace behavioral claims to real producers, user actions, or lifecycle paths, and structural claims to actual dependencies or maintenance activities. Check consequential external assumptions against their producing contracts, including authority, completeness, ordering, and failure semantics. Synthetic fixtures, unusual ordering, and reviewer agreement do not by themselves establish harm.

## Decide findings

For each candidate, first decide whether it is worth addressing before developing a detailed replacement:

- Establish the supported expected behavior and reachable path for a behavioral concern, or the concrete maintenance activity and cost for a structural concern. A reproduction establishes what happens under its assumptions, not whether that behavior is wrong or worth changing.
- Identify the material consequence, constraint, or risk and its likelihood or recurrence from available evidence; state what remains unknown. Structural improvements need a demonstrated maintenance burden, not a user-visible defect.
- Compare the strongest keep-current case with a plausible improvement and its likely costs. Use enough comparison to judge whether work is worthwhile; do not require a completed design at this point.

Use a fresh read-only subagent at this point to challenge material candidates' evidence, expected behavior, and value, including the keep-current case. Supply raw paths, product constraints, and these criteria without seeding the conclusion. Resolve disagreements against evidence. If independent review is unavailable or disproportionate, record why and perform a separate second pass.

Develop a concrete replacement only for candidates whose value is supported. Trace it through affected callers and contracts, and accept the finding only if it improves the whole model after accounting for added state, coordination, lifecycle, UX, compatibility, and testing costs. Prefer the simplest coherent owner and end state; do not preserve material debt just to keep a fix local. Retain compatibility that belongs to the supported product. Have independent review challenge material architecture judgments as they emerge; the initial value assessment does not establish that the replacement is sound.

Classify candidates as accepted, rejected with reasons, or unresolved. Use unresolved only when evidence supports material importance and specific missing evidence prevents a decision; identify that evidence. Reject candidates when improvement value is unsupported and keeping the current design is reasonable. Reopen rejected candidates only for material new evidence. Investigation depth should follow consequence and uncertainty, not an exhaustive enumeration of possible edge cases.

## Deliverable

Rank accepted findings by architectural consequence and dependency order. Give exact sources, current cost, target design, relevant impact, and remaining uncertainty. Summarize rejected candidates, unresolved material questions, and achieved coverage. A no-finding result is valid; qualify it by material coverage gaps. Do not turn speculative cleanup into findings or present an unqualified pass while a consequential question remains unresolved.

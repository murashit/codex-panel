---
name: codex-panel-change-workflow
description: Implement and finish an individual Codex Panel code, test, or documentation change, including compatibility changes. Read before starting. Excludes standalone repository-wide diagnosis and release preparation or publication.
---

# Codex Panel Change Workflow

Use [AGENTS.md](../../../AGENTS.md) for working principles, review requirements, and completion responsibility, and [Development](../../../docs/development.md) for engineering criteria and validation. Apply specialized skills when relevant; this workflow does not expand authorization for external actions.

## Establish and implement the change

Establish the requested outcome, current behavior, affected contracts, and material open questions. Follow-up findings refine that outcome unless the user changes scope. For defects, reproduce the cause at the cheapest reliable layer; use the development guide's [live-validation conditions](../../../docs/development.md#validate-in-obsidian).

Choose the approach under [Choose the Owner of a Change](../../../docs/development.md#choose-the-owner-of-a-change), involving the design contributor when required by AGENTS.md. Give independent contributors the request, constraints, source, contracts, and open questions before sharing a preferred conclusion. Keep them involved as implementation evidence changes the decision. Parallelize only substantial independent concerns with little shared-file contention.

## Review and validate

Apply the [review criteria](../../../docs/development.md#review-and-simplify-a-change), including duplication review, to the affected behavior and its tests and fixtures. Use the [test criteria](../../../docs/development.md#write-tests-that-survive-refactoring) for existing, added, and removed cases.

For independent final review, supply the required outcomes, constraints, comparison base, final source, and validation evidence. Let reviewers assess the design, behavior, contracts, regressions, and related paths beyond the diff before sharing preferred conclusions or prior verdicts. Resolve findings and renew review and validation under AGENTS.md; an earlier pass does not establish the final result.

## Deliver the change

Organize history and prepare the PR under [Record the Change](../../../docs/development.md#record-the-change); prefer Jujutsu when available. Complete the [handoff validation](../../../docs/development.md#validate-a-change) on the final change.

Report the resulting behavior, including any UI additions or removals, important choices, review outcome, verification coverage, and material limitations. Keep work reports separate from product copy and user documentation.

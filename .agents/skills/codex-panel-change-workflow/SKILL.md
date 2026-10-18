---
name: codex-panel-change-workflow
description: Implement and finish an individual Codex Panel code, test, or documentation change, including compatibility changes. Read at the start and revisit during review, simplification, history organization, and PR preparation. Excludes standalone repository-wide diagnosis and release preparation or publication.
---

# Codex Panel Change Workflow

Read this skill before implementation or substantive guidance edits. Use `docs/development.md` for shared design comparisons, review and test criteria, validation commands, and commit/PR conventions; use `AGENTS.md` for principles, mandatory reviews, and completion responsibility. Return to the relevant guidance as the work evolves rather than waiting until PR publication. Apply specialized skills when their descriptions match the work; their procedures complement this change workflow without restarting it. This skill does not expand authorization for external actions.

## Start and iterate

Keep the user's requested outcomes and material open questions in view throughout the task. Follow-up findings extend or refine that work unless the user changes its scope; resolving the latest example does not close the broader concern.

Before choosing an implementation, use [Choose the Owner of a Change](../../../docs/development.md#choose-the-owner-of-a-change) to compare the whole user-contract path, including existing owners and test guarantees. Revisit that comparison when evidence changes an assumption. Reproduce defects at the cheapest deterministic layer that exercises the suspected cause; use the live-validation conditions in `docs/development.md`. Parallelize only substantial independent concerns with little shared-file contention; keep tightly coupled work together.

## Review and simplify

Use the independent review conditions in `AGENTS.md`. Give reviewers the required outcomes, constraints, comparison base, and implementation and validation evidence. Withhold the implementer's preferred conclusion or structure, simplification claims, and prior review verdicts until their initial assessment; ask for assessment against the requirements rather than justification of the proposed implementation.

Apply [Review and Simplify a Change](../../../docs/development.md#review-and-simplify-a-change) and [Write Tests That Survive Refactoring](../../../docs/development.md#write-tests-that-survive-refactoring) to the related implementation, tests, fixtures, and documentation, including pre-existing paths outside the diff. Review the assurance provided by the existing and proposed arrangement together, rather than justifying additions individually.

After review-driven edits, recheck the affected contracts, comparisons, and validation. If a later change could alter a review judgment, have that part assessed again against the final head, using independent review where required. A review or CI pass for an earlier state does not establish completion of the final change.

Once substantial implementation works and known findings are resolved, request the separate fresh read-only simplification pass required by `AGENTS.md`, using the neutral reviewer instructions above and the shared comparison criteria. The primary agent owns the decision: assess the related structure and alternatives, implement worthwhile improvements, then review and validate the result. Record the comparison and decision briefly in the work discussion. Review agreement does not replace this assessment.

## Organize history and prepare the PR

Jujutsu is the recommended local change-management workflow when available. Inspect and reorganize the graph using the coherent-commit criteria in [Record the Change](../../../docs/development.md#record-the-change). Follow the required validation after subsequent edits and history organization, and before handoff or publication.

The PR author owns the quality of the body. Apply the PR guidance in `docs/development.md` to the final diff, checking language, scope, validation, limitations, and necessary references before publication.

Lead the final report with the resulting behavior and material limitations, explicitly identifying UI additions, changes, and removals. Summarize verification and its coverage, who independently reviewed what and with what outcome, and the simplification decision. Keep delivery explanations distinct from copy that belongs in the product or its user documentation. Complete the full requested outcomes and material open questions under the primary agent's responsibility in `AGENTS.md`.

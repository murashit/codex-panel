---
name: codex-panel-change-workflow
description: Implement and finish an individual Codex Panel code, test, or documentation change, including compatibility changes. Read at the start and revisit during review, simplification, history organization, and PR preparation. Excludes standalone repository-wide diagnosis and release preparation or publication.
---

# Codex Panel Change Workflow

Read this skill before implementation or substantive guidance edits. Use `docs/development.md` for shared design comparisons, review and test criteria, validation commands, and commit/PR conventions; use `AGENTS.md` for principles, mandatory reviews, and completion responsibility. Return to the relevant guidance as the work evolves rather than waiting until PR publication. Apply specialized skills when their descriptions match the work; their procedures complement this change workflow without restarting it. This skill does not expand authorization for external actions.

## Establish the approach

Keep the user's requested outcomes and material open questions in view throughout the task. Follow-up findings extend or refine that work unless the user changes its scope; resolving the latest example does not close the broader concern.

Before settling the implementation, apply [Choose the Owner of a Change](../../../docs/development.md#choose-the-owner-of-a-change). Under the conditions in `AGENTS.md`, involve an independent read-only design/simplification contributor now. Give them the request, constraints, current source and contracts, and open questions. Let them establish the necessary guarantees, existing owners and boundaries, and concrete alternatives before sharing the implementer's preferred approach. Ask them to challenge the requirements and premises as well as the structure.

For nontrivial design choices, briefly record the alternatives compared under the linked design criteria, where the required guarantees already live or need to move, and the reason for choosing among alternatives that meet the required behavior, considering structure, guarantees, and maintenance burden. Keep this decision record in the work discussion and pass it to implementation.

Reproduce defects at the cheapest deterministic layer that exercises the suspected cause; use the live-validation conditions in `docs/development.md`. Parallelize only substantial independent concerns with little shared-file contention; keep tightly coupled work together.

## Implement and reconsider

Where a design/simplification contributor is involved, continue with them as implementation evidence emerges. Apply [Review and Simplify a Change](../../../docs/development.md#review-and-simplify-a-change) to the related implementation, fixtures, documentation, and pre-existing paths outside the diff. Check whether the expected simplicity and placement of guarantees actually hold. Reopen the approach when findings invalidate a premise; get fresh independent reconsideration under the conditions in `AGENTS.md` rather than relying only on a continuing contributor's earlier judgment.

Review existing and changed tests together under [Write Tests That Survive Refactoring](../../../docs/development.md#write-tests-that-survive-refactoring), and feed the resulting integration, addition, or removal decisions back into implementation.

During implementation review, run and assess `npm run review:duplication` under [Investigate Duplication](../../../docs/development.md#investigate-duplication). Reuse the report for an unchanged source state.

## Verify the final change

Use the independent final-review conditions in `AGENTS.md`, including its separate requirement for substantive guidance edits. Give the reviewer required outcomes, constraints, comparison base, final source, and validation evidence. Withhold preferred conclusions, simplification claims, and prior review verdicts until their initial assessment. A reviewer who did not participate in design must be free to question that design, trace production paths and contracts beyond the diff, and assess regressions and the combined test guarantees; do not narrow their task to checking compliance with the chosen plan.

Resolve findings against evidence and reconsider the approach when needed. After edits that could alter a review judgment, have that part assessed again against the final head, with independence where required, and re-run affected validation. An earlier review or CI pass does not establish completion of the final change.

Before the primary agent's completion decision under `AGENTS.md`, record the disposition of material findings and a short substantive reason for retaining or revising the resulting structure and tests, with remaining questions or blockers.

## Organize history and prepare the PR

Jujutsu is the recommended local change-management workflow when available. Inspect and reorganize the graph using the coherent-commit criteria in [Record the Change](../../../docs/development.md#record-the-change). Follow the required validation after subsequent edits and history organization, and before handoff or publication.

The PR author owns the quality of the body. Apply the PR guidance in `docs/development.md` to the final diff, checking language, scope, validation, limitations, and necessary references before publication.

Lead the final report with the resulting behavior and material limitations, explicitly identifying UI additions, changes, and removals. Summarize verification and its coverage, who independently reviewed what and with what outcome, and the simplification decision. Keep delivery explanations distinct from copy that belongs in the product or its user documentation.

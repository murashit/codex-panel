This repository contains the Codex Panel Obsidian plugin.

## Working Principles

- Ground decisions in current behavior, user needs, and authoritative boundary contracts. Treat documentation, tests, theory, and reviewer agreement as inputs—not substitutes—for evidence.
- Prefer the smallest coherent user-facing model with clear semantic ownership over preserving existing work. Treat review findings and edge cases as reasons to reopen the design, and make them ordinary consequences of the model rather than exceptions preserved by compensating patches.
- Keep the Panel thin. Remove needless abstraction, duplicated ownership, and obsolete compatibility instead of preserving them through local complexity.
- Keep implementation, tests, documentation, policy, and final history mutually consistent.

## What To Read

- Read `README.md` for user-facing behavior, requirements, commands, privacy, and compatibility.
- Read `docs/design.md` when changing responsibility boundaries, runtime ownership, app-server source-of-truth behavior, UI ownership, or testing philosophy.
- Read `docs/development.md` before implementation work, generated binding work, source layout decisions, validation, or compatibility baseline changes.
- Read `docs/release.md` for release preparation, release notes, preflight, tagging, pushing, and release repair.
- Use the repo-local skills in `.agents/skills/` when a task matches a more specific workflow.

## Changes And Validation

### Implementation And Validation

- Reproduce defects at the cheapest deterministic layer that exercises the suspected cause. Use live Obsidian validation only when material integration behavior remains outside automation.
- Parallelize only substantial independent concerns with little shared-file contention; keep tightly coupled work together.
- Follow `docs/development.md` for repository rules and required validation. Re-run relevant validation after history edits and before handoff or publication.

### Change Review

- Review behavior, responsibility boundaries, implementation quality, and regression risk. Changes to responsibility or dependency boundaries, shared-state ownership, or asynchronous operation lifetimes require a fresh read-only subagent for independent design and regression review. Predominantly moving code, passing tests, and the implementer's own review do not waive this requirement. For other changes, use a fresh read-only subagent when independence materially improves confidence; otherwise use a direct second pass.
- Select review angles according to the changed behavior and risk; not every angle applies to every change. Look beyond the diff at paired or analogous paths, callers, and boundary definitions and configuration. Check for unintended asymmetry, duplicated sources of truth, ineffective indirection, and changed defaults affecting untouched consumers. Verify consequential claims in the change description and tests against implementation, relevant history, or authoritative documentation for the actual dependency version.
- Follow failures and interrupted or concurrent operations through state changes to what users can see and do: can an error become apparent success, lose useful context, leave inconsistent data, or allow a conflicting action? Check that validation exercises the real contract and isolates external side effects. Assess relevant performance risks using expected data size, call frequency, and measurements.
- Check that non-obvious intent and coupled assumptions remain discoverable for future edits. Prefer explicit dependencies in code, adding explanation where the rationale would otherwise be lost. Ground maintainability findings in a concrete change scenario and consequence.
- For refactoring, compare the whole design before and after: weigh removed responsibilities, state, and indirection against added concepts and coordination. Consider whether a simpler structure preserves the same boundaries, and retain added complexity only when the improvement justifies it. Treat implementation and test line-count changes as prompts for comparison, not size limits or reduction targets.
- Separate demonstrated problems from hypotheses and optional improvements; preference or speculative future flexibility is not a defect. Before acting on a finding, identify the violated invariant and owner, and record why material findings are addressed or rejected.

### Completion And History

- After substantial implementation, resolve review findings, complete required validation, and finish the implementation change. Then use a fresh subagent for a bounded cleanup pass in code touched or encountered during the work, including pre-existing complexity outside the diff. Keep only refactoring that materially reduces ownership, indirection, branching, duplication, or code size while preserving behavior and clarity. Avoid repository-wide exploration or cosmetic churn; if no worthwhile cleanup is found, make no changes. Review and validate resulting refactoring according to its scope and risk.
- Jujutsu is the recommended local change-management workflow when available. Use Conventional Commits for new commits, and make each final change a coherent review unit with an honest description. Before publishing, inspect and reorganize the graph as needed: normally fold corrective follow-ups into the concern they complete, split mixed changes, and keep follow-ups separate only when meaningful on their own.
- In the final report, state who reviewed the current change, what they examined, and the outcome. Separately describe any cleanup performed, or report that no worthwhile cleanup was found.

## Documentation And Agent Instructions

- Before editing, briefly record the intended reader and task or decision, the missing or inaccurate guidance, and the evidence for that gap. Read the relevant existing guidance and identify overlap. If no gap is supported, leave the document unchanged.
- Match the content and level of detail to the document's purpose. Choose the smallest change that leaves the affected guidance concise, coherent, and sufficient for the reader's task; judge this by the resulting text rather than changed-line count. Consider integrating, reordering, or deleting existing text. Keep a rule's scope no broader than its evidence supports. Include rationale only when it helps an ongoing reader task or decision.
- Review the resulting section as a whole with its surrounding guidance. Check whether the reader can find the required actions, their order, and applicable conditions, and whether each bullet groups related decisions. Assess what would be lost without the change and whether existing text already serves that need; compare the proposed structure with integrating or reorganizing existing guidance. Record a keep, revise, or remove decision with the reason. Keep the editing and review notes in the work discussion, outside the maintained document.
- Use a fresh read-only reviewer for substantive changes to guidance or policy. Ask them to assess necessity, scope, accuracy, and the resulting section's usability under the criteria above, and resolve their findings before handoff. Routine corrections and removals can use a direct second pass.

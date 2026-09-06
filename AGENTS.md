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

- Reproduce defects at the cheapest deterministic layer that exercises the suspected cause. Use live Obsidian validation only when material integration behavior remains outside automation.
- Review the current change for design quality and regression risk: assess whether its behavior, responsibility boundaries, and implementation are appropriate, and whether it breaks existing behavior. Changes to responsibility or dependency boundaries, shared-state ownership, or asynchronous operation lifetimes require an independent design and regression review by a fresh read-only subagent. Predominantly moving code, passing tests, and the implementer's own review do not waive this requirement. For other changes, use a fresh read-only subagent when independence materially improves confidence; otherwise use a direct second pass. Before acting on a finding, identify the violated invariant and owner, and record why material findings are addressed or rejected.
- For refactoring, compare the whole design before and after: weigh removed responsibilities, state, and indirection against added concepts and coordination. Consider whether a simpler structure can preserve the same boundaries, and retain added complexity only when the improvement justifies it. Use implementation and test line-count changes as prompts for this comparison, not as limits or reduction targets.
- After substantial implementation, resolve the change review findings, complete required validation, and finish the implementation change. Then use a fresh child for a bounded cleanup pass in the code touched or encountered during the work. This is a Boy Scout refactoring opportunity: leave the surrounding code a little better, including pre-existing complexity outside the diff. Keep only refactoring that materially reduces ownership, indirection, branching, duplication, or code size while preserving behavior and clarity. Avoid repository-wide exploration or cosmetic churn; if no worthwhile cleanup is found, make no changes. Review and validate any resulting refactoring according to its scope and risk.
- In the final report, state who reviewed the current change, what they examined, and the outcome. Separately describe any cleanup performed, or report that no worthwhile cleanup was found.
- Parallelize only substantial independent concerns with little shared-file contention; keep tightly coupled work together.
- Jujutsu is the recommended local change-management workflow when available. Make each final change a coherent review unit with an honest description.
- Before publishing, inspect and reorganize the graph when needed rather than preserving implementation chronology: normally fold corrective follow-ups into the concern they complete, split mixed changes, and keep a follow-up separate only when it remains meaningful on its own.
- Use Conventional Commits for new commits and follow `docs/development.md` for repository rules and validation. Re-run relevant validation after history edits and before handoff or publication.

## Documentation And Agent Instructions

- Before editing, briefly record the intended reader and task or decision, the missing or inaccurate guidance, and the evidence for that gap. Read the relevant existing guidance and identify overlap. If no gap is supported, leave the document unchanged.
- Match the content and level of detail to the document's purpose. Choose the smallest change that closes the gap, including deletion or revision of existing text. Keep a rule's scope no broader than its evidence supports. Include rationale only when it helps an ongoing reader task or decision.
- Review the proposed change with its surrounding guidance. Ask what the reader would lose without it, whether existing text already serves that need, and whether a smaller change would suffice. Record a keep, revise, or remove decision with the reason. Keep the editing and review notes in the work discussion, outside the maintained document.
- Use a fresh read-only reviewer for substantive changes to guidance or policy. Ask them to assess necessity and scope as well as accuracy, and resolve their findings before handoff. Routine corrections and removals can use a direct second pass.

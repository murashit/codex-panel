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
- Use descriptions in `.agents/skills/` to select applicable workflows. Read them before beginning the work they cover, including any agent approval boundaries, and return to relevant sections as the task progresses.

## Changes And Validation

- Follow `docs/development.md` for repository rules and required validation. Re-run relevant validation after subsequent edits and history organization, and before handoff or publication.
- Review behavior, responsibility boundaries, implementation quality, and regression risk. Changes to responsibility or dependency boundaries, shared-state ownership, or asynchronous operation lifetimes require a fresh read-only subagent for independent design and regression review. Predominantly moving code, passing tests, and the implementer's own review do not waive this requirement. For other changes, use a fresh read-only subagent when independence materially improves confidence; otherwise use a direct second pass.
- After substantial implementation works and known change-review findings are resolved, use a fresh read-only subagent for a separate simplification pass before declaring the task complete. Use the applicable workflow for review scope and reviewer instructions.
- The primary agent owns simplification and completion decisions against the full requested outcomes and material open questions. Independently assess the related structure and alternatives, implement worthwhile improvements, and review and validate the result. Review agreement and passing checks support this assessment but do not replace it. Continue authorized work when a gap remains; distinguish unresolved evidence or a genuine blocker from completed work rather than narrowing the scope to declare success.

## Documentation And Agent Instructions

- Before editing, briefly record the intended reader and task or decision, the missing or inaccurate guidance, and the evidence for that gap. Read the relevant existing guidance and identify overlap. If no gap is supported, leave the document unchanged.
- Match the content and level of detail to the document's purpose. Choose the smallest change that leaves the affected guidance concise, coherent, and sufficient for the reader's task; judge this by the resulting text rather than changed-line count. Consider integrating, reordering, or deleting existing text. Keep a rule's scope no broader than its evidence supports. Include rationale only when it helps an ongoing reader task or decision.
- Review the resulting section as a whole with its surrounding guidance. Check whether the reader can find the required actions, their order, and applicable conditions, and whether each bullet groups related decisions. Assess what would be lost without the change and whether existing text already serves that need; compare the proposed structure with integrating or reorganizing existing guidance. Record a keep, revise, or remove decision with the reason. Keep the editing and review notes in the work discussion, outside the maintained document.
- Use a fresh read-only reviewer for substantive changes to guidance or policy. Ask them to assess necessity, scope, accuracy, and the resulting section's usability under the criteria above, and resolve their findings before handoff. Routine corrections and removals can use a direct second pass.

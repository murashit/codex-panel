This repository contains the Codex Panel Obsidian plugin.

## Working Principles

- Meet the user's requested outcomes with a coherent model whose responsibilities, state, and dependencies are clear and economical to maintain. Prefer correcting ownership over adding compensating mechanisms; retain compatibility for supported needs.
- Ground decisions in current behavior, user needs, and authoritative boundary contracts. Documentation, tests, and reviewer agreement are evidence to assess, not substitutes for judgment.
- Match investigation and comparison depth to consequence and uncertainty. Reconsider assumptions when findings challenge them, including those shared by paths outside the diff.
- Keep implementation, tests, documentation, policy, and final history mutually consistent.

## What To Read

| Task or decision | Guidance |
| --- | --- |
| User-facing behavior, requirements, commands, privacy, compatibility | [README](README.md) |
| Product scope, responsibility boundaries, state and UI ownership | [Design](docs/design.md) |
| Implementation, source placement, tests, validation, compatibility, commits and PRs | [Development](docs/development.md) |
| Release version and notes, finalization, publication, recovery | [Release](docs/release.md) |
| Task-specific workflow | Select applicable descriptions in [.agents/skills/](.agents/skills/) and read those skills before starting |

## Review and Completion

- When design choices materially affect complexity, especially responsibility or dependency boundaries, shared-state ownership, or asynchronous lifetimes, involve an independent read-only design/simplification contributor before settling the approach and throughout implementation. Require final behavior, contract, and regression review by a fresh read-only subagent who did not participate in design or implementation and can challenge the design itself.
- Obtain fresh independent reconsideration when assumptions or design materially change, or a continuing contributor is too invested in the earlier choice. Other changes can use a direct second pass unless independent review materially improves confidence; trivial changes do not require formal alternatives or extra reviewers.
- Substantive guidance or policy changes require a fresh read-only reviewer to assess necessity, scope, accuracy, and usability. Routine corrections and removals can use a direct second pass.
- Resolve material findings against evidence. After edits that could change a review judgment, renew the affected review with independence where required. Run the [required validation](docs/development.md#validate-a-change) on the final result, repeating affected checks after edits or history organization and before handoff or publication.
- The primary agent owns adoption and completion against the full requested outcomes and material open questions. Continue authorized work on gaps; explain important choices, verification limits, and unresolved findings or blockers in the work report. Passing checks or review agreement alone does not establish completion.

## Maintaining Guidance

Change guidance to resolve a concrete reader need or inaccurate information. Read related guidance first, integrate overlap, and keep each rule in the document that owns it. Leave guidance unchanged when no gap is supported.

Keep the resulting section concise and sufficient for its reader's task: required actions, order where it matters, and applicable conditions should be easy to find. Scope rules to the evidence and include rationale when it helps a continuing decision. Keep important policy-change reasons and editing notes in the work discussion, not the maintained document.

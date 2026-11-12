This repository contains the Codex Panel Obsidian plugin.

## Working Principles

Ground changes in requested outcomes, actual behavior, and authoritative contracts. Prefer clear ownership and a simpler complete model over compensating state or coordination. Keep implementation, tests, guidance, and final history consistent.

## What To Read

| Task | Guidance |
| --- | --- |
| Supported behavior and requirements | [README](README.md) |
| Product, state, and UI responsibility boundaries | [Design](docs/design.md) |
| Implementation, tests, validation, commits and PRs | [Development](docs/development.md) |
| Live Obsidian validation | [Obsidian Dev skill](.agents/skills/codex-panel-obsidian-dev/SKILL.md) |
| CLI baseline and generated bindings | [App-Server Update skill](.agents/skills/codex-panel-app-server-update/SKILL.md) |
| Repository-wide architecture review | [Design Review skill](.agents/skills/codex-panel-design-review/SKILL.md) |
| Release preparation, publication, recovery | [Release](docs/release.md); [release skill](.agents/skills/codex-panel-release/SKILL.md) is the task entry point |
| CI diagnosis, scheduled workflows, GitHub App setup | [Automation](docs/automation.md) |

Read the applicable guidance before starting; ordinary changes need no separate workflow skill.

## Review and Completion

- For design choices materially affecting complexity, responsibility or dependency boundaries, shared state, or asynchronous lifetimes, involve an independent read-only design contributor before settling the approach; revisit the design review when implementation evidence changes the decision. Require final behavior, contract, and regression review by a fresh read-only subagent who did not participate in design or implementation.
- Obtain fresh reconsideration when assumptions or design materially change, or a continuing contributor is too invested in the earlier choice. Substantive guidance or policy changes also require a fresh read-only reviewer for necessity, scope, accuracy, and usability. Other changes can use a direct second pass; trivial changes need no formal alternatives or extra reviewers.
- Repository-wide review-only assessments use a fresh read-only contributor to challenge material findings. If unavailable or disproportionate, record why and perform a separate second pass; this does not waive required reviews for implementation.
- Give reviewers the requested outcomes, constraints, relevant source/contracts, comparison base, and available validation evidence before sharing preferred conclusions or earlier verdicts. They may challenge the design and related paths outside the diff. Resolve material findings against evidence; renew affected review when edits could change its judgment.
- Complete [validation](docs/development.md#validate-a-change) on the final result, repeating affected checks after edits or history organization. The primary agent owns the full requested outcome and open questions; checks and reviewer agreement alone do not establish completion. Report behavior, important choices, review and verification results, and material gaps.

## Maintaining Guidance

Change guidance for a concrete reader need or inaccurate information. Read related guidance first, keep each rule with one owner, and make required actions and conditions easy to find. Keep editing rationale and work logs in the discussion.

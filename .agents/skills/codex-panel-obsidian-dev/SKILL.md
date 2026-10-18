---
name: codex-panel-obsidian-dev
description: Validate Codex Panel in live Obsidian using the local CLI for runtime, DOM, styling, and interaction checks.
---

# Codex Panel Obsidian Dev

## Ground Rules

- Use `docs/development.md` for build and deployment expectations. Before CLI inspection or reload, confirm that the Obsidian CLI is available and targets the intended vault with the plugin enabled and that its deployment loads this checkout's artifacts. Model interactions require Codex authentication on that host.
- If the desktop host is unavailable, run the applicable automated checks and report the specific material integration checks still needed; do not treat desktop unavailability as a failure of build or test validation.
- Do not install a desktop host or request model credentials merely to run build, test, metadata, or binding checks.
- Use existing authorization for live validation, including the necessary build, plugin reload, and Panel interaction. Ask only when a needed action exceeds that scope, such as unrelated vault changes or intrusive debugging not covered by the request.
- Prefer read-only inspection before state-changing commands.
- Do not clear console or error buffers unless the user approves; clearing can destroy useful failure context.

## Workflow

Use [Validate in Obsidian](../../../docs/development.md#validate-in-obsidian) for shared build/deployment conditions, CLI reload and inspection commands, and dynamic UI investigation. Select the commands needed to test the affected interaction under the authorization boundaries above.

## Reporting

Report the observed behavior, runtime errors, intrusive actions taken, and evidence paths. State any material validation gap and its cause.

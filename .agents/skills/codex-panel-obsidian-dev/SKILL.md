---
name: codex-panel-obsidian-dev
description: Use when validating Codex Panel inside a live Obsidian app with the local `obsidian` CLI, including plugin reloads, command execution, DOM/CSS inspection, screenshots, captured console output, captured runtime errors, Electron devtools, CDP commands, or mobile emulation.
---

# Codex Panel Obsidian Dev

## Ground Rules

- Use `docs/development.md` for the build and generated-asset expectations before live Obsidian validation.
- Ask before altering or reloading the live Obsidian session, attaching a debugger, or running intrusive evaluation or input commands.
- Prefer read-only inspection before state-changing commands.
- Do not clear console or error buffers unless the user approves; clearing can destroy useful failure context.

## Workflow

1. Build the plugin when source changes need to be reflected in Obsidian:

   ```bash
   npm run build
   ```

2. If approved, reload the plugin when the live session needs the new build:

   ```bash
   obsidian plugin:reload id=codex-panel
   ```

3. Open the relevant surface when needed:

   ```bash
   obsidian command id=codex-panel:open-panel
   obsidian command id=codex-panel:open-threads-view
   ```

4. Inspect runtime health:

   ```bash
   obsidian plugin id=codex-panel
   obsidian dev:errors
   obsidian dev:dom selector=.codex-panel total
   obsidian dev:css selector=.codex-panel
   obsidian dev:screenshot path=<scratch-path>/codex-panel.png
   ```

5. Use focused Codex Panel-owned selectors found in the relevant implementation or styles.

## Dynamic UI Investigations

When behavior depends on layout, asynchronous rendering, or virtualized DOM state, capture the visible state and relevant DOM metrics before and after the real input path, then again after rendering settles. Compare framework or data state with the DOM where possible. Remove temporary probes and instrumentation before final validation and re-check runtime errors.

## Reporting

Report the observed behavior, runtime errors, intrusive actions taken, and evidence paths. State when an approval-gated check was skipped.

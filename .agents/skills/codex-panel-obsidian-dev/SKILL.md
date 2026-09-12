---
name: codex-panel-obsidian-dev
description: Validate Codex Panel in live Obsidian using the local CLI for runtime, DOM, styling, and interaction checks.
---

# Codex Panel Obsidian Dev

## Ground Rules

- Use `docs/development.md` for the build and generated-asset expectations before live Obsidian validation.
- Use existing authorization for live validation, including the necessary build, plugin reload, and Panel interaction. Ask only when a needed action exceeds that scope, such as unrelated vault changes or intrusive debugging not covered by the request.
- Prefer read-only inspection before state-changing commands.
- Do not clear console or error buffers unless the user approves; clearing can destroy useful failure context.

## Workflow

1. Build the plugin when source changes need to be reflected in Obsidian:

   ```bash
   npm run build
   ```

2. Reload the plugin when authorized live validation needs the new build:

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

Report the observed behavior, runtime errors, intrusive actions taken, and evidence paths. State any material validation gap and its cause.

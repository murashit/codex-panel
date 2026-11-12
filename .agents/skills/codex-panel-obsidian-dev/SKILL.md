---
name: codex-panel-obsidian-dev
description: Validate Codex Panel in live Obsidian using the local CLI for runtime, DOM, styling, and interaction checks.
---

# Codex Panel Obsidian Dev

## Ground Rules

- Before CLI inspection or reload, confirm the target vault and current checkout artifacts using the workflow below.
- If the desktop host is unavailable, run the applicable automated checks and report the specific material integration checks still needed; do not treat desktop unavailability as a failure of build or test validation.
- Do not install a desktop host or request model credentials merely to run build, test, metadata, or binding checks.
- Use existing authorization for live validation, including the necessary build, plugin reload, and Panel interaction. Ask only when a needed action exceeds that scope, such as unrelated vault changes or intrusive debugging not covered by the request.
- Prefer read-only inspection before state-changing commands.
- Do not clear console or error buffers unless the user approves; clearing can destroy useful failure context.

## Workflow

In a supported Obsidian desktop app, enable Codex Panel in the test vault and make sure its plugin directory loads the checkout's current `main.js`, `manifest.json`, and `styles.css`. Make sure the current source is built, then reload the plugin before testing the affected interaction. Model interactions require an authenticated Codex CLI on that host.

When the Obsidian CLI is available and targets that vault, use the relevant commands below. Reload after building the current source; open only the surface needed for the interaction:

```sh
obsidian plugin:reload id=codex-panel
obsidian command id=codex-panel:open-panel
obsidian command id=codex-panel:open-threads-view
```

Inspect runtime health and the affected UI with commands such as:

```sh
obsidian plugin id=codex-panel
obsidian dev:errors
obsidian dev:dom selector=.codex-panel total
obsidian dev:css selector=.codex-panel
obsidian dev:screenshot path=<scratch-path>/codex-panel.png
```

Use focused Codex Panel-owned selectors found in the relevant implementation or styles. When behavior depends on layout, asynchronous rendering, or virtualized DOM state, capture the visible state and relevant DOM metrics before and after the real input path, then again after rendering settles. Compare framework or data state with the DOM where possible. Remove temporary probes and instrumentation before final validation and re-check runtime errors.

## Reporting

Report the observed behavior, runtime errors, intrusive actions taken, and evidence paths. State any material validation gap and its cause.

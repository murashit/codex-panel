---
name: codex-panel-obsidian-dev
description: Use when validating Codex Panel inside a live Obsidian app with the local `obsidian` CLI, including plugin reloads, command execution, DOM/CSS inspection, screenshots, captured console output, captured runtime errors, Electron devtools, CDP commands, or mobile emulation.
---

# Codex Panel Obsidian Dev

Use this skill for live Obsidian checks after building Codex Panel or when investigating behavior that unit tests cannot observe.

## Ground Rules

- Work from the Codex Panel repository root.
- Use `docs/development.md` for the build and generated-asset expectations before live Obsidian validation.
- Treat `obsidian plugin:reload id=codex-panel`, `obsidian reload`, `obsidian restart`, `obsidian devtools`, `obsidian eval`, `obsidian dev:cdp`, and `obsidian dev:mobile` as state-changing or intrusive. Ask the user before running them.
- Prefer read-only inspection first: `plugin`, `commands`, `dev:errors`, `dev:dom`, `dev:css`, `dev:console`, `dev:screenshot`, `version`.
- If `dev:console` reports that the debugger is not attached, ask before running `obsidian dev:debug on`.
- Do not clear console or error buffers unless the user approves; clearing can destroy useful failure context.

## Workflow

1. Build the plugin when source changes need to be reflected in Obsidian:

   ```bash
   npm run build
   ```

2. Before reloading the live plugin, ask the user whether it is OK to reload their current Obsidian session. If approved:

   ```bash
   obsidian plugin:reload id=codex-panel
   ```

3. Open the relevant Codex Panel surface when needed:

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

5. Use focused selectors for the behavior under test. Prefer stable Codex Panel classes such as `.codex-panel`, `.codex-panel__composer`, `.codex-panel-threads`, and `.codex-panel-chat-turn-diff`.

## Dynamic UI Investigations

When checking behavior that depends on browser layout, asynchronous rendering, or virtualized DOM state, measure the live UI rather than inferring from unit tests alone.

- Capture both the user-visible state and the underlying DOM metrics. Useful fields include `scrollTop`, `scrollHeight`, `clientHeight`, element bounding rects, rendered element counts, inline styles, and relevant computed styles.
- For virtualized or asynchronously rendered regions, compare framework state against DOM state where possible, such as virtualizer total size versus actual `scrollHeight`, rendered item count versus data count, or pre-event versus post-frame measurements.
- Prefer real input paths for input-sensitive bugs. Use `obsidian dev:cdp method=Input.dispatchMouseEvent ...` or focused keyboard events when a synthetic `dispatchEvent()` may skip browser/Electron behavior.
- Record measurements before the action, immediately after the action, after at least one animation frame, and after a short timeout when layout, markdown rendering, resize observers, or virtualizer settle loops may run later.
- If injecting temporary DOM probes with `obsidian eval`, remove them before finishing and re-check `dev:errors`. Avoid leaving long-running eval promises; use bounded `setTimeout`-based scripts that resolve.
- Treat console instrumentation as temporary. Remove debug logging before final validation, and search the touched files for probe markers or conflict markers before reporting.

## Common Checks

- Confirm the loaded version and enabled state:

  ```bash
  obsidian plugin id=codex-panel
  ```

- List available Codex Panel commands:

  ```bash
  obsidian commands filter=codex-panel
  ```

- Count rendered elements:

  ```bash
  obsidian dev:dom selector=.codex-panel__composer total
  ```

- Inspect text, attributes, or computed styles:

  ```bash
  obsidian dev:dom selector=.codex-panel__composer text
  obsidian dev:dom selector=.codex-panel__composer attr=aria-label
  obsidian dev:dom selector=.codex-panel__composer css=display
  obsidian dev:css selector=.codex-panel__composer
  ```

- Capture a screenshot for visual review:

  ```bash
  obsidian dev:screenshot path=<scratch-path>/codex-panel.png
  ```

## Reporting

Report the commands run, whether Obsidian was reloaded, key `dev:errors` or `dev:console` findings, and any screenshot path produced. If a command was skipped because it required user approval, state that plainly.

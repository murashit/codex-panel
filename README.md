# Codex Panel

Codex Panel is a desktop-only Obsidian plugin that opens a right-sidebar panel for Codex. It starts `codex app-server` locally over stdio and uses the current vault root as the Codex working directory.

The plugin does not manage Codex runtime policy itself. Model, reasoning effort, sandbox, approvals, network access, MCP, hooks, and related behavior are resolved by Codex for the vault root, including a vault-local `.codex/config.toml` when present.

## Status

Codex Panel is currently distributed as a beta plugin for BRAT/manual installation. It is developed and tested with Codex CLI 0.130.0.

The plugin depends on the experimental `codex app-server` API. Later Codex CLI releases may require regenerated app-server bindings or compatibility fixes.

## Requirements

- Obsidian desktop app.
- Codex CLI installed, authenticated, and available as `codex`, or a custom executable path configured in the plugin settings.
- A vault where Codex is allowed to work according to your Codex CLI configuration.

## Installation

### BRAT

1. Install and enable the BRAT plugin in Obsidian.
2. In BRAT, choose `Add Beta plugin`.
3. Enter the repository URL:

```text
https://github.com/murashit/codex-panel
```

4. Enable `Codex Panel` from Obsidian's Community plugins list.
5. Open the panel from the ribbon or command palette.

### Manual

Download the release assets and place them in:

```text
<vault>/.obsidian/plugins/codex-panel/
```

Required release assets:

- `main.js`
- `manifest.json`
- `styles.css`

Then reload Obsidian and enable `Codex Panel` from Community plugins.

## Getting Started

Open the command palette and run:

- `Codex Panel: Open panel`
- `Codex Panel: New chat`

If Obsidian cannot find `codex`, open the plugin settings and set `Codex executable` to an absolute path such as `/opt/homebrew/bin/codex`.

The status dot in the panel opens connection controls, diagnostics, usage limits, and the effective Codex config for the current vault. The effective config view is diagnostic only; it does not save settings.

## Features

- Start, resume, rename, and archive Codex threads from Obsidian.
- Stream user, assistant, reasoning, command, tool, hook, and file-change events.
- Respond to command, file, permission, and Plan mode approval requests.
- Toggle Plan mode, fast mode, model override, and reasoning effort override for subsequent turns.
- Send steering messages during a running turn, or interrupt the turn when the composer is empty.
- Show recent chat history, paged older turns, context usage, connection diagnostics, and effective config.
- Inspect and manage discovered Codex hooks, including enabled state, trust status, and current hash.
- Complete vault wikilinks, slash commands, and enabled Codex skills in the composer.
- Resolve Obsidian wikilinks in sent messages into Codex file mentions when the target exists.

## Slash Commands

- `/compact`: request context compaction for the active thread.
- `/fast`: toggle fast service tier for subsequent turns.
- `/plan`: toggle Plan mode for subsequent turns. Add text after the command to toggle mode and send that text immediately, for example `/plan OK, implement it`.
- `/status`: show current connection, thread, runtime, and context status.
- `/doctor`: show connection diagnostics.
- `/model`: show, set, or clear model override.
- `/effort`: show, set, or clear reasoning effort override.
- `/help`: list slash commands.

## Privacy and Security

Codex Panel does not make its own network requests. It exchanges data with the configured `codex app-server` process over stdio. Messages, steering input, approvals, resolved file mentions, thread history requests, hook status requests, effective config requests, and archived-thread management requests are sent to Codex app-server and then handled according to the user's Codex CLI configuration, authentication, model provider, sandbox, approval, MCP, hook, and network settings.

The plugin stores only panel settings in Obsidian plugin data: the Codex executable path and optional automatic thread naming model/effort overrides. It does not store API keys.

Obsidian wikilinks in sent messages are resolved into structured file mentions only when the target file exists. The visible message text is preserved, unresolved wikilinks are not expanded, and note bodies are not automatically attached by the panel.

## Development

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, ESLint, Prettier check, and a production esbuild bundle.

`main.js`, `data.json`, and `node_modules/` are ignored by Git. `main.js` is still the file Obsidian loads, so run `npm run build` or `npm run build:prod` after source changes.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields such as collaboration mode and generated v2 types.

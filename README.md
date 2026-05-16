# Codex Panel

Codex Panel is a desktop-only Obsidian plugin that opens Codex in the right sidebar. It starts `codex app-server` locally, talks to it over stdio, and uses the current vault root as the Codex working directory.

Codex still owns model selection, sandboxing, approvals, MCP, hooks, network access, and other runtime policy. Codex Panel is the Obsidian side-panel UI for that app-server session.

## Requirements

- Obsidian desktop app 1.12.0 or newer.
- Codex CLI installed, authenticated, and available as `codex`, or configured with an absolute executable path in the plugin settings.
- A vault where Codex is allowed to work according to your Codex CLI configuration.

Codex Panel does not support Obsidian mobile.

## Installation

Install Codex Panel from Obsidian's Community plugins browser:

1. Open `Settings`.
2. Go to `Community plugins`.
3. Select `Browse`.
4. Search for `Codex Panel`.
5. Install and enable the plugin.

You can also open the plugin page directly: <https://community.obsidian.md/plugins/codex-panel>.

## How It Works

The current vault root is the app-server working directory. For project vaults, Codex sees the project next to your notes. For plain note vaults, the vault itself is the workspace.

Each open panel has its own app-server connection, active thread, pending requests, and composer draft. Thread history and configuration still come from Codex for the same vault root.

## Opening the Panel

Open the command palette and run `Codex Panel: Open panel`, or use the ribbon icon. If Obsidian cannot find `codex`, set `Settings` > `Codex Panel` > `Codex executable` to an absolute path such as `/opt/homebrew/bin/codex`.

Use `Codex Panel: New chat` to start a fresh thread. Use `Codex Panel: Open new panel` when you want multiple Codex threads side by side.

## Supported Codex Workflows

Codex Panel supports the Codex workflows that are useful from a side panel:

- Start, resume, rename, fork, roll back, compact, and archive threads.
- Stream assistant messages, reasoning, commands, tool calls, hooks, file changes, and agent activity.
- Respond to command, file, and permission approval requests.
- Answer Plan mode questions and copy proposed plans.
- Toggle Plan mode, fast mode, model override, and reasoning effort override for subsequent turns.
- Send steering messages during a running turn, or interrupt when the composer is empty.
- Inspect context usage, usage limits, connection diagnostics, and effective config.
- Inspect and manage discovered Codex hooks from Obsidian settings.
- Complete slash commands and enabled Codex skills in the composer.

## Obsidian Integration

Codex Panel makes a few Obsidian-specific adjustments instead of mirroring the terminal UI exactly:

- Wikilinks in sent messages are resolved to Codex file mentions when the target file exists. The visible message text is preserved, unresolved wikilinks are left alone, and note bodies are not attached automatically.
- Forking a thread opens the fork in a new right-sidebar panel so the source thread stays visible.
- Rolling back is limited to thread history; see File Changes and Rollback.
- The composer sends with `Enter` by default, with `Shift+Enter` for a newline. You can switch sending to `Cmd/Ctrl+Enter` in the plugin settings.

## File Changes and Rollback

Codex Panel shows file-change activity and turn-level diffs reported by Codex app-server so you can review what changed. These diffs are for inspection and copying; they are not a restore source.

Rolling back a turn only removes the latest Codex turn from thread history and restores that turn's user prompt to the composer. It does not revert files changed by Codex. Use your normal project or vault workflow, such as Git, to review or revert local file changes.

## Configuration and Diagnostics

Codex configuration stays in Codex. Defaults and runtime policy, including model, reasoning effort, sandboxing, approvals, MCP servers, hook definitions, network access, and providers, should be configured the same way you configure Codex CLI.

The settings tab stores only panel-specific preferences: Codex executable path, composer send shortcut, and optional model/effort overrides for automatic thread naming. Model and reasoning effort controls in the panel are temporary inputs for subsequent turns, not saved Codex defaults.

The status dot opens connection controls and diagnostics, including effective config and usage limits. The settings tab can load app-server-backed hook status and archived threads on demand, including hook trust and enabled state. Codex Panel can show and request those app-server operations, but it does not edit or duplicate Codex config.

## Privacy and Security

Codex Panel does not make its own network requests. It exchanges data with the configured `codex app-server` process over stdio. Messages, steering input, approvals, resolved file mentions, thread history operations, hook status requests, effective config requests, and archived-thread management requests are sent to Codex app-server and then handled according to your Codex CLI configuration.

The plugin does not store API keys.

## Compatibility

Codex Panel depends on the experimental `codex app-server` API. Later Codex CLI releases may require regenerated app-server bindings or compatibility fixes.

The current release is developed and tested with Codex CLI 0.130.0.

## Project Docs

- [Development](docs/development.md)
- [Release](docs/release.md)

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

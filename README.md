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

- Start, resume, rename, fork, roll back, compact, and archive threads (`/new`, `/resume`, `/fork`, `/rollback`, `/compact`).
- Complete slash commands (`/help`) and enabled Codex skills in the composer.
- Send steering messages during a running turn, or interrupt when the composer is empty.
- Toggle Plan mode, fast mode, model override, and reasoning effort override for subsequent turns (`/plan`, `/fast`, `/model`, `/effort`).
- Respond to command, file, and permission approval requests.
- Answer Plan mode questions and copy proposed plans.
- Stream assistant messages, reasoning, commands, tool calls, hooks, file changes, and agent activity.
- Inspect file changes and roll back the latest turn without reverting local files.
- Inspect context usage, usage limits, connection diagnostics, and effective config (`/status`, `/doctor`).
- Inspect and manage discovered Codex hooks from Obsidian settings.
- Rewrite the current Markdown editor selection from an inline popover.

## Obsidian Integration

Codex Panel makes a few Obsidian-specific adjustments instead of mirroring the terminal UI exactly:

- Wikilinks in sent messages are resolved to Codex file mentions when the target file exists. The visible message text is preserved, unresolved wikilinks are left alone, and note bodies are not attached automatically.
- Markdown links in rendered messages that point to existing vault files open in Obsidian. External links and non-vault file paths keep their normal link behavior.
- Forking a thread opens the fork in a new right-sidebar panel so the source thread stays visible.
- Rolling back is limited to thread history. It restores the rolled-back prompt to the composer, but it does not revert files changed by Codex.
- The composer sends with `Enter` by default, with `Shift+Enter` for a newline. You can switch sending to `Cmd/Ctrl+Enter` in the plugin settings.

## Selection Rewrites

Use `Codex Panel: Rewrite selection` when you want Codex to rewrite a specific passage in the active Markdown editor without starting a normal chat turn. Select text, run the command, describe the rewrite you want, review the streamed preview and selection-scoped diff, then apply the replacement.

Selection rewrites run in a short-lived Codex app-server session instead of the open panel thread. Codex receives the selected text, the current editor buffer as note context, and your instruction, then returns replacement text. Codex Panel applies that replacement through the Obsidian editor only after you confirm it; Codex is not asked to edit the file directly.

The command stops with a notice when there is no active Markdown note or the selection is empty. Generation can fail if Codex cannot start, the request is interrupted, or the model does not return the expected replacement output. Applying can also fail when the selected range changed after generation; regenerate the rewrite so the replacement is based on the current text.

The settings tab includes optional model and reasoning effort overrides for selection rewrites. Leave them as Codex default unless you want rewrite requests to use a different runtime from automatic thread naming and normal panel turns.

## Configuration and Diagnostics

Codex configuration stays in Codex. Configure defaults and runtime policy such as model, reasoning effort, sandboxing, approvals, MCP servers, hooks, network access, and providers the same way you configure Codex CLI.

The Codex Panel settings tab stores only panel-specific preferences: Codex executable path, composer send shortcut, and optional model/effort overrides for automatic thread naming and selection rewrites. Model and reasoning effort controls in the panel toolbar are temporary inputs for subsequent turns, not saved Codex defaults.

The status dot opens connection controls and diagnostics, including effective config, context usage, and usage limits. The settings tab can load app-server-backed hook status and archived threads on demand, including hook trust and enabled state. Codex Panel can show and request these app-server operations, but it does not duplicate Codex config as Obsidian settings.

## Privacy and Security

Codex Panel does not make its own network requests. It exchanges data with the configured `codex app-server` process over stdio. Messages, steering input, approvals, resolved file mentions, thread history operations, hook status requests, effective config requests, and archived-thread management requests are sent to Codex app-server and then handled according to your Codex CLI configuration.

The plugin does not store API keys.

## Compatibility

| Key                      | Version   | Policy                                                                                              |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `obsidian.minAppVersion` | `1.12.0`  | Track the latest patch in this minor; raise this baseline when adopting a newer Obsidian API minor. |
| `codex.testedCliVersion` | `0.130.0` | Manage app-server compatibility by Codex CLI minor version.                                         |

Codex Panel depends on the experimental `codex app-server` API. Later Codex CLI releases may require regenerated app-server bindings or compatibility fixes.

## Project Docs

- [Development](docs/development.md)
- [Release](docs/release.md)

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

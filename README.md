# Codex Panel

Codex Panel is a desktop-only Obsidian plugin that brings Codex into the right sidebar. It starts `codex app-server` locally, talks to it over stdio, and uses the current vault root as the Codex working directory.

Codex remains the source of truth for models, reasoning effort, sandbox modes, approval policies, MCP servers, hooks, network access, and other runtime policy. Codex Panel provides the Obsidian side-panel UI for that Codex App Server session.

## Requirements

- Obsidian desktop app 1.12.0 or newer.
- Codex CLI installed, authenticated, and available as `codex`, or configured with an absolute executable path in Codex Panel settings.
- A vault where Codex is allowed to work according to your Codex CLI configuration.

Codex Panel does not support Obsidian mobile.

## Installation

Install Codex Panel from Obsidian's Community plugins browser:

1. Open **Settings**.
2. Go to **Community plugins**.
3. Select **Browse**.
4. Search for **Codex Panel**.
5. Install and enable the plugin.

You can also open the plugin page directly: <https://community.obsidian.md/plugins/codex-panel>.

## How it works

The current vault root is the Codex working directory. For project vaults, Codex sees the project next to your notes. For plain note vaults, the vault itself is the workspace.

Each open panel has its own Codex App Server connection, active thread, pending requests, and composer draft. Thread history, archived threads, hooks, and runtime configuration still come from Codex for the same vault root.

## Open the panel

Open the command palette and run **Codex Panel: Open panel**, or select the ribbon icon. If Obsidian cannot find `codex`, set **Settings → Codex Panel → Codex executable** to an absolute path, such as `/opt/homebrew/bin/codex`.

Use **Codex Panel: New chat** to start a fresh thread. Use **Codex Panel: Open new panel** when you want multiple Codex threads side by side.

## Supported Codex workflows

Codex Panel supports Codex App Server workflows that fit a persistent side panel:

- Start, resume, rename, fork, roll back, compact, and archive threads (`/new`, `/resume`, `/fork`, `/rollback`, `/compact`, `/archive`).
- Complete slash commands (`/help`) and enabled Codex skills from the composer.
- Reference another non-archived thread without switching away from the current one (`/refer <thread> <message>`). Codex receives up to 20 recent turns, limited to user input and final Codex responses.
- Toggle Plan mode, optionally sending the same message after switching (`/plan <message>`), then answer questions and copy or implement proposed plans.
- Toggle fast mode, model, and reasoning effort for subsequent turns (`/fast`, `/model`, `/effort`).
- Toggle approval auto-review for subsequent turns (`/auto-review`).
- Send steering messages during a running turn, or interrupt when the composer is empty.
- Respond to command, file, and permission approval requests.
- Stream assistant messages, reasoning, commands, tool calls, hooks, file changes, and agent activity.
- Codex goal management is not supported. Incoming goal notifications are shown only as brief system notices.
- Inspect file changes and roll back the latest turn without reverting local files.
- Inspect context usage, usage limits, connection diagnostics, MCP servers, and effective config (`/status`, `/doctor`, `/mcp`).
- Inspect and manage discovered Codex hooks from Codex Panel settings.
- Rewrite the current Markdown editor selection from an Obsidian editor command.

## Obsidian integration

Codex Panel adds vault-aware behavior where Obsidian benefits from a different surface than the terminal UI:

- Wikilinks in sent messages resolve to Codex file mentions when the target file exists. The visible message text is preserved, unresolved wikilinks are left alone, and note bodies are not attached automatically.
- Markdown links in rendered messages that point to existing vault files open in Obsidian. External links and non-vault file paths keep their normal link behavior.
- Forking a thread opens the fork in a new right-sidebar panel so the source thread stays visible.
- Thread archiving can save a Markdown note in the vault before the thread is archived. Configure the folder, filename template, and optional fixed tags in Codex Panel settings.
- The composer sends with `Enter` by default, with `Shift+Enter` for a newline. You can switch sending to `Cmd/Ctrl+Enter` in Codex Panel settings.
- **Codex Panel: Rewrite selection** rewrites selected text in the active Markdown editor without starting a normal chat turn. The command requires a non-empty selection in an active Markdown note. Codex sees the selection, the current editor buffer as note context, and your instruction, then returns a replacement preview with a selection-scoped diff.
- Selection rewrites run in a short-lived Codex App Server session, separate from the current panel thread. Nothing is written to the note until you confirm the preview. If the selected text changes before applying, Codex Panel asks you to regenerate so the replacement still matches the editor state you reviewed.

## Configuration and diagnostics

Codex configuration stays in Codex. Configure model defaults, reasoning effort, sandbox modes, approval policies, MCP servers, hooks, network access, and providers the same way you configure Codex CLI.

Codex Panel settings store only panel-specific preferences: Codex executable path, composer send shortcut, optional archive export folder and filename templates, optional archive export tags, and optional model and reasoning effort choices for automatic thread naming and selection rewrites. Toolbar model and effort controls are temporary inputs for subsequent turns.

The status dot opens connection controls and diagnostics, including effective config, context usage, and usage limits. Codex Panel settings can also load hook status and archived threads from Codex App Server.

## Privacy and security

Codex Panel does not make its own network requests. It exchanges data with the configured `codex app-server` process over stdio. Messages, steering input, approvals, resolved file mentions, thread history operations, hook status requests, effective config requests, and archived-thread management requests are sent to Codex App Server and handled according to your Codex CLI configuration.

The plugin does not store API keys.

## Compatibility

| Key                      | Version   | Policy                                                                                              |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `obsidian.minAppVersion` | `1.12.0`  | Track the latest patch in this minor; raise this baseline when adopting a newer Obsidian API minor. |
| `codex.testedCliVersion` | `0.133.0` | Manage app-server compatibility by Codex CLI minor version.                                         |

Codex Panel depends on the experimental `codex app-server` API. Later Codex CLI releases may require regenerated App Server bindings or compatibility fixes.

## Project docs

- [Development](docs/development.md)
- [Release](docs/release.md)

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

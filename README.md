# Codex Panel

Codex Panel brings your existing Codex setup into an Obsidian sidebar, so you can work with Codex beside your notes without switching to a terminal or separate app window.

If your Codex CLI or Codex.app environment is already configured, Codex Panel gives that setup a persistent Obsidian pane with note-aware links, threads, archives, and editor selections. It stays thin: runtime behavior continues to come from Codex, not from a separate plugin configuration layer.

## Why use it

- Reuse your existing Codex configuration and credentials.
- Work with persistent Codex threads in Obsidian panes, including multiple panels side by side and a sidebar thread list.
- Compose with Obsidian wikilinks, rendered vault links, and Codex file mentions.
- Review Codex file changes, rewrite selected note text, and archive useful threads without leaving the vault.

## How it works

Codex Panel runs `codex app-server` as a local child process and talks to it over stdio. Each open chat panel has its own app-server connection, active thread, pending requests, and composer draft. The vault root is passed to Codex as the working directory.

Models, reasoning defaults, sandboxing, approvals, MCP servers, hooks, skills, providers, network access, and thread history continue to come from Codex configuration. Codex Panel stores panel preferences only, not API keys or provider credentials. Data sent from the panel is handled by the configured Codex CLI according to your Codex configuration.

## Requirements

- Obsidian desktop app 1.12.0 or newer.
- Codex CLI installed, authenticated, and available as `codex`, or configured with an absolute executable path in Codex Panel settings.
- A vault where Codex is allowed to work according to your Codex CLI configuration.

Codex Panel does not support Obsidian mobile.

## Installation

Install Codex Panel from Obsidian's Community plugins browser by searching for **Codex Panel**, then install and enable the plugin.

You can also open the plugin page directly: <https://community.obsidian.md/plugins/codex-panel>.

## Quick start

1. Open the command palette and run **Codex Panel: Open panel**, or select the ribbon icon.
2. If Obsidian cannot find `codex`, set **Settings -> Codex Panel -> Codex executable** to an absolute path such as `/opt/homebrew/bin/codex`.
3. Ask Codex to work on the vault or project from the composer.
4. Return to earlier work from **Codex Panel: Open thread...** or the Threads sidebar view.

## Using Codex Panel

Each panel keeps its own active thread, so you can keep separate conversations side by side. Start a fresh chat when you need a clean thread, or reopen recent non-archived threads from the thread picker.

The Threads sidebar gives you a vault-local view of Codex work in progress. It shows which threads are open, running, or waiting for input, and lets you resume, rename, auto-name, fork, roll back, compact, or archive threads. Forks open in a new right-sidebar pane so the source thread stays visible; fork-and-archive replaces the source panel with the forked thread.

### Compose with vault context

The composer understands Obsidian and Codex context together. Wikilink suggestions come from Obsidian file search and recent notes; sent wikilinks resolve to Codex file mentions when possible; rendered vault file links open back in Obsidian.

Completions are also available for slash commands, enabled skills such as `$skill-name`, recent threads, models, and supported reasoning efforts. Use `/help` in the composer for the current slash command list. You can reference another non-archived thread without leaving the active panel, or use `/refer` when you want Codex to include recent turns from another thread in a message.

While a turn is running, the panel streams assistant messages, reasoning, commands, tool calls, hooks, file changes, plan updates, and agent activity. You can answer Codex questions, approve commands, respond to MCP and file requests, send steering messages, or interrupt the turn when the composer is empty. If a thread has an active Codex goal, the panel shows it above the message stream and lets you edit, pause, resume, or clear it.

### Review edits in Obsidian

Codex file changes can be reviewed in an Obsidian diff view with a changed-files list and copy-diff action.

For note-local edits, select Markdown text and run **Codex Panel: Rewrite selection**. Codex Panel sends the current editor buffer as context, receives a replacement, and shows a selection-scoped diff before applying it.

### Adjust a thread

Use the toolbar, composer status row, or slash commands to inspect context usage and usage limits, toggle Plan mode, fast mode, and approval auto-review, and set model or reasoning effort for subsequent turns when the connected Codex version supports those controls.

When troubleshooting, use the toolbar status panel or diagnostic slash commands to inspect the active thread, connection, Codex CLI, app-server capabilities, discovered hooks, and runtime debug details.

### Keep useful threads as notes

Threads can be archived as Markdown notes in your vault with a configurable folder, filename template, and tags. You can also archive without saving, then restore or permanently delete archived threads from settings.

## Compatibility

| Key                      | Version   | Policy                                                                                              |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `manifest.minAppVersion` | `1.12.0`  | Minimum Obsidian desktop version declared for plugin loading.                                       |
| `obsidian` API types     | `1.12.3`  | TypeScript API package used for compile-time checks; kept in the same minor as `manifest` baseline. |
| `codex.testedCliVersion` | `0.142.0` | Track app-server compatibility by Codex CLI minor version.                                          |

Codex Panel depends on the experimental `codex app-server` API.

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

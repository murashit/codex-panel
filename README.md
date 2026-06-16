# Codex Panel

Codex Panel brings your existing Codex setup into an Obsidian sidebar. It starts `codex app-server` locally, uses the current vault root as the Codex working directory, and leaves Codex in charge of models, reasoning effort, sandbox modes, approval policies, MCP servers, hooks, skills, providers, network access, and thread history.

The plugin is intentionally thin: it is an Obsidian surface for Codex, not a separate AI client with its own runtime policy. If your Codex CLI or Codex.app environment is already configured, Codex Panel uses that same runtime behavior in a persistent Obsidian pane, with note-aware support for links, threads, archives, and editor selections.

Use it when you want Codex beside your notes, not in a separate terminal or app window.

## Why use it

- Keep Codex next to the notes, specs, plans, and project context you are editing in Obsidian.
- Reuse Codex configuration instead of configuring models, sandboxing, approvals, MCP servers, hooks, skills, providers, or credentials again.
- Work with persistent Codex threads in Obsidian panes, including multiple panels side by side.
- Navigate threads from an Obsidian sidebar view, with live status for currently open threads.
- Use vault-aware composing: wikilink suggestions come from Obsidian files, sent wikilinks resolve to Codex file mentions when possible, and rendered vault file links open in Obsidian.
- Archive Codex threads as Markdown notes in your vault.
- Rewrite selected note text with Codex, then review a selection-scoped diff before applying the replacement.

## How it works

Codex Panel runs `codex app-server` as a local child process and talks to it over stdio. Each open chat panel has its own app-server connection, active thread, pending requests, and composer draft. The vault root is passed to Codex as the working directory.

Codex remains the runtime authority:

- Model and reasoning defaults come from Codex configuration.
- Sandbox mode, approval policy, approval reviewer, network policy, MCP servers, hooks, skills, provider settings, and thread history are owned by Codex.
- Codex Panel can display and adjust supported per-thread runtime controls, but it does not replace Codex configuration.
- Codex Panel stores panel preferences only. It does not store API keys or provider credentials.

That boundary is also the privacy and security boundary. Data sent from the panel is handled by the configured Codex CLI according to your Codex configuration.

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

## Quick start

1. Open the command palette and run **Codex Panel: Open panel**, or select the ribbon icon.
2. If Obsidian cannot find `codex`, set **Settings -> Codex Panel -> Codex executable** to an absolute path such as `/opt/homebrew/bin/codex`.
3. Ask Codex to work on the vault or project from the composer.
4. Use **Codex Panel: Open thread...** or **Codex Panel: Open threads view** to return to recent non-archived Codex threads.
5. Select text in a Markdown note and run **Codex Panel: Rewrite selection** when you want a note-local rewrite with a reviewable diff.

By default, `Enter` sends and `Shift+Enter` inserts a newline. You can switch sending to `Cmd/Ctrl+Enter` in Codex Panel settings.

## What you can do

### Panels and threads

- Open one Codex panel in the right sidebar, or open multiple panels for multiple threads.
- Start a fresh thread in the current panel.
- Resume, rename, auto-name, fork, roll back, compact, and archive Codex threads.
- Use the left sidebar Threads view to browse non-archived threads and see which ones are open, running, or waiting for input.
- Forks open in a new right-sidebar pane so the source thread stays visible; fork-and-archive replaces the source panel with the forked thread.

### Compose and steer turns

- Compose with completions for slash commands, enabled skills (`$skill-name`), recent threads, models, and supported reasoning efforts.
- Reference another non-archived thread without switching away from the current one.
- Follow a running turn as Codex streams assistant messages, reasoning, commands, tool calls, hooks, file changes, plan updates, and agent activity.
- Respond to Codex questions, command approvals, file approvals, MCP requests, and permission requests.
- Send steering messages while a turn is running, or interrupt when the composer is empty.
- Show the active Codex goal above the message stream, then edit, pause, resume, or clear it from the panel.

### Runtime controls and diagnostics

- Inspect context usage from the composer status row.
- Toggle Plan mode, fast mode, and approval auto-review for subsequent turns.
- Set the model and reasoning effort for subsequent turns when supported by Codex.
- Inspect usage limits, connection diagnostics, MCP servers, enabled skills, runtime debug details, and discovered hooks from the toolbar, settings, or slash commands.

### Obsidian-native workflows

- Use wikilink suggestions backed by Obsidian file search and recent notes.
- Send resolved wikilinks as Codex file mentions when the target exists.
- Open rendered Markdown links to vault files in Obsidian.
- Review Codex file changes in an Obsidian diff view with changed files and a copy-diff action.
- Archive threads as Markdown notes with configurable folder, filename template, and tags, archive without saving, then restore or permanently delete archived threads from settings.
- Rewrite selected note text using the current editor buffer as context, then review the replacement diff before applying it.

Rollback restores the latest prompt in the Codex thread. It does not undo file edits in your vault.

## Commands

### Obsidian commands

The command palette entries are ordered by the workflow they support: opening panels, finding threads, managing the active chat, and editing note text.

| Command                            | What it does                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Codex Panel: Open panel**        | Open or focus a Codex panel.                                                                                                       |
| **Codex Panel: Open new panel**    | Open another Codex panel.                                                                                                          |
| **Codex Panel: Open thread...**    | Search non-archived threads from a picker. Press `Enter` to open in the current panel, or `Cmd/Ctrl+Enter` to open in a new panel. |
| **Codex Panel: Open threads view** | Open the left sidebar thread list.                                                                                                 |
| **Codex Panel: Start new chat**    | Clear the current panel for a fresh Codex thread.                                                                                  |
| **Codex Panel: Rewrite selection** | Rewrite selected Markdown note text with Codex and review a selection-scoped diff before applying it.                              |

### Slash commands

Use `/help` in the composer to show the available slash commands. The list below follows the same groups shown in help.

#### Panel actions

| Command                   | What it does                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `/clear`                  | Clear the current panel and start a fresh Codex thread.       |
| `/resume [thread]`        | Resume a recent Codex thread.                                 |
| `/reconnect`              | Reconnect to `codex app-server` and resume the active thread. |
| `/fork`                   | Fork the active Codex thread.                                 |
| `/rollback`               | Roll back the latest turn and restore its prompt.             |
| `/compact`                | Compact the current thread context.                           |
| `/archive <thread>`       | Archive the selected Codex thread.                            |
| `/rename <thread> <name>` | Rename the selected Codex thread.                             |

#### Thread settings

| Command                       | What it does                                       |
| ----------------------------- | -------------------------------------------------- |
| `/auto-review`                | Toggle approval auto-review.                       |
| `/fast`                       | Toggle fast service tier for subsequent turns.     |
| `/plan [message]`             | Toggle Plan mode, optionally with a message.       |
| `/goal`                       | Show the current thread goal.                      |
| `/goal set <objective>`       | Create or update the current thread goal.          |
| `/goal edit`                  | Load the current thread goal into the composer.    |
| `/goal pause`                 | Pause the current thread goal.                     |
| `/goal resume`                | Resume the current thread goal.                    |
| `/goal clear`                 | Clear the current thread goal.                     |
| `/model [model\|default]`     | Show or set the model for subsequent turns.        |
| `/reasoning [level\|default]` | Show or set reasoning effort for subsequent turns. |

#### Diagnostics

| Command   | What it does                                     |
| --------- | ------------------------------------------------ |
| `/status` | Show current thread, context, and usage limits.  |
| `/doctor` | Show Codex CLI and Codex App Server diagnostics. |
| `/mcp`    | Show MCP servers reported by Codex App Server.   |
| `/help`   | Show available slash commands.                   |

#### Composition

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `/refer <thread> <message>` | Send a message with recent turns from another non-archived thread. |

## Privacy and security

Codex Panel acts as a local Obsidian client for Codex App Server:

- It does not make network requests itself. It talks to the configured `codex app-server` process over stdio.
- User input, approvals, resolved file mentions, and thread/configuration operations are sent to Codex App Server.
- It stores only panel-specific preferences, not API keys or provider credentials.
- Network access, sandbox behavior, approval policy, and other runtime policy are controlled by your Codex CLI configuration.

## Compatibility

| Key                      | Version   | Policy                                                     |
| ------------------------ | --------- | ---------------------------------------------------------- |
| `obsidian.minAppVersion` | `1.12.0`  | Track the latest patch for this Obsidian minor.            |
| `codex.testedCliVersion` | `0.140.0` | Track app-server compatibility by Codex CLI minor version. |

Codex Panel depends on the experimental `codex app-server` API.

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

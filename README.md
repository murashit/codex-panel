# Codex Panel

Codex Panel is a desktop-only Obsidian plugin that brings Codex into a panel in the right sidebar. It is built as an Obsidian frontend for `codex app-server`: the plugin starts Codex locally, communicates with it over stdio, and uses the current vault root as the Codex working directory.

Codex stays in charge of models, reasoning effort, sandbox modes, approval policies, MCP servers, hooks, skills, network access, providers, and thread history. Codex Panel adds the Obsidian surface around that Codex App Server connection instead of replacing Codex configuration or policy.

That boundary is also the privacy and security boundary: Codex Panel does not store API keys or make its own network requests. Data sent from the panel is handled by the configured Codex CLI according to your Codex configuration.

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

## Open and manage panels

Open the command palette and run **Codex Panel: Open panel**, or select the ribbon icon. If Obsidian cannot find `codex`, set **Settings → Codex Panel → Codex executable** to an absolute path, such as `/opt/homebrew/bin/codex`.

Use **Codex Panel: Start new chat** to clear the current panel for a fresh conversation. Use **Codex Panel: Open new panel** when you want multiple Codex threads side by side. Each open panel has its own Codex App Server connection, active thread, pending requests, and composer draft.

Use **Codex Panel: Open thread...** to search non-archived threads from a picker; press `Enter` to focus an already open thread or open it in the current panel, or `Cmd/Ctrl+Enter` to focus an already open thread or open it in a new panel. Use **Codex Panel: Open threads view** to open a left sidebar view of non-archived threads, including live status for threads that are currently open.

## Codex workflow tools

Codex Panel supports Codex App Server workflows that fit a persistent panel in Obsidian:

- Manage thread history from the panel or slash commands: start (`/new`), resume (`/resume`), rename, auto-name, fork (`/fork`), roll back (`/rollback`), compact (`/compact`), and archive (`/archive`) Codex threads.
- Compose with Codex-aware completions for slash commands, enabled skills (`$skill-name`), recent threads, models, and supported reasoning efforts; use `/help` to show available slash commands.
- Reference another non-archived thread without switching away from the current one (`/refer`).
- Control subsequent turns from the toolbar or slash commands: Plan mode (`/plan`), fast mode (`/fast`), approval auto-review (`/auto-review`), model (`/model`), and reasoning effort (`/effort`).
- Follow a running turn as Codex streams assistant messages, reasoning, commands, tool calls, hooks, file changes, plan updates, and agent activity.
- Respond to Codex questions, command approvals, file approvals, MCP requests, and permission requests; send steering messages; or interrupt when the composer is empty.
- Inspect context usage, usage limits, connection diagnostics, MCP servers, enabled skills, effective Codex config, and discovered hooks from the toolbar, settings, or `/status`, `/doctor`, and `/mcp`.

Codex goal management is not supported. Incoming goal notifications are shown only as brief system notices.

## Obsidian integration

Codex Panel adds vault-aware behavior where Obsidian benefits from a different surface than the terminal UI:

- Keep Codex next to your notes in Obsidian panes. The Threads view adds a left sidebar list with live status for currently open threads, and forks open in a new pane in the right sidebar so the source thread stays visible.
- Use Obsidian commands and the ribbon icon for panel and thread navigation.
- Compose with Obsidian-friendly shortcuts: `Enter` sends by default, `Shift+Enter` inserts a newline, and you can switch sending to `Cmd/Ctrl+Enter` in Codex Panel settings.
- Use vault-aware links while composing and reading messages. Wikilink suggestions use Obsidian file search and recent notes; sent wikilinks resolve to Codex file mentions when the target exists; rendered Markdown links to vault files open in Obsidian.
- Review Codex file changes in an Obsidian diff view with changed files and a copy-diff action. Use rollback to restore the latest prompt, not to undo file edits.
- Archive threads as Markdown notes in the vault with configurable folder, filename template, and tags, or archive without saving from the chat toolbar or Threads view.
- Rewrite selected note text with Codex using the current editor buffer as context, then review a selection-scoped diff before applying the replacement.

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
| `codex.testedCliVersion` | `0.134.0` | Track app-server compatibility by Codex CLI minor version. |

Codex Panel depends on the experimental `codex app-server` API.

## Project docs

- [Development](docs/development.md)
- [Release](docs/release.md)

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

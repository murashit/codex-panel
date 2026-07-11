# Codex Panel

Codex Panel brings Codex into an Obsidian sidebar. It keeps Codex threads beside your notes, helps you add vault context to prompts, and lets you handle approvals and file changes without switching windows.

If the Codex CLI is already installed and authenticated, Codex Panel uses that local setup. The plugin handles the Obsidian side of the workflow, while models, credentials, sandboxing, tools, hooks, and thread state stay with Codex.

![Codex Panel](assets/screenshot.webp)

## Why use it

- Keep Codex work next to the notes or projects it is about.
- Bring notes, selections, links, and attachments into prompts.
- Manage threads and respond to Codex requests inside Obsidian.
- Review file changes, rewrite selected note text, and archive useful threads as notes.

## How it works

Codex Panel starts `codex app-server` locally. Each open panel keeps its own active thread and draft, with Codex working from the vault root.

Codex Panel stores panel preferences only, not API keys or provider credentials.

## Requirements

- Obsidian desktop app 1.12.0 or newer.
- Codex CLI installed, authenticated, and available as `codex`, or configured with an absolute executable path in Codex Panel settings.
- A local vault where Codex is allowed to work.

Codex Panel does not support Obsidian mobile.

## Installation

Install Codex Panel from Obsidian's Community plugins browser by searching for **Codex Panel**, then install and enable the plugin.

You can also open the plugin page directly: <https://community.obsidian.md/plugins/codex-panel>.

## Quick start

1. Open the command palette and run **Codex Panel: Open panel**, or select the ribbon icon.
2. If Obsidian cannot find `codex`, set **Settings -> Codex Panel -> Codex executable** to an absolute path such as `/opt/homebrew/bin/codex`.
3. Ask Codex to work on the vault or project from the composer.
4. Return to earlier work from **Codex Panel: Open thread...** or **Codex Panel: Open threads view**.

## Using Codex Panel

Each panel can keep a separate conversation, so related work can stay open side by side, including temporary read-only side chats. Start fresh from the panel, reopen recent threads from the picker or panel history, or use the Threads view to see active work across the vault.

The composer treats Obsidian content as prompt context. It suggests vault files and recent notes for wikilinks, keeps links readable while attaching resolved files, and opens file links from Codex replies back in Obsidian. Use `@active` or `@selection` to include the active file or current Markdown selection without pasting it manually, or enable **Reference active file on send** to reference the current active file with each composer send. When Obsidian Daily Notes or the daily section of Periodic Notes is enabled, `@today`, `@tomorrow`, and `@yesterday` insert wikilinks using that daily-note folder and date format. Paste or drop files to save them in the attachment folder and reference them from the same prompt.

For context outside the current composer, use `/refer <thread> <message>` to send a message with recent turns from another Codex thread, or `/clip <url> [message]` to save a readable Markdown clipping from a web page and send a wikilink to the saved note.

Completions cover slash commands, `$skill-name` skills, Obsidian tags, recent threads, models, reasoning levels, and permission profiles. Use `/help` for the current command list.

While a turn is running, the panel streams the conversation, reasoning, tool activity, file changes, plans, and agent activity. You can answer Codex questions, approve commands, respond to requests, steer or interrupt the turn, and manage active goals above the conversation.

When Codex changes files, open an Obsidian diff view to review the changes and copy the patch. For a focused note edit, select Markdown text and run **Codex Panel: Rewrite selection** to ask Codex for a replacement and review a selection-scoped diff before applying it.

Use the toolbar, composer status row, or slash commands to inspect usage, adjust turn settings, and check Codex connection details.

Threads can be archived as Markdown notes with a configurable folder, filename template, and tags. You can also archive without saving, then restore or permanently delete archived threads from settings.

## Compatibility

| Key                      | Version   | Policy                                                                                              |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `manifest.minAppVersion` | `1.12.0`  | Minimum Obsidian desktop version declared for plugin loading.                                       |
| `obsidian` API types     | `1.12.3`  | TypeScript API package used for compile-time checks; kept in the same minor as `manifest` baseline. |
| `codex.testedCliVersion` | `0.144.0` | Track app-server compatibility by Codex CLI minor version.                                          |

Codex Panel depends on the experimental `codex app-server` API.

## License

Codex Panel is licensed under the Apache License 2.0. See `LICENSE`.

The generated TypeScript bindings under `src/generated/app-server/` are generated from OpenAI Codex CLI app-server types. See `NOTICE` for upstream attribution.

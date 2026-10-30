# Codex Panel

Codex Panel is a dedicated Codex frontend for Obsidian. Work with Codex beside your notes, bring vault references into prompts, and review edits without leaving your workspace. The panel combines Obsidian integration with controls for Codex models, permissions, plans, and conversations, using your existing local Codex CLI installation, authentication, and configuration.

![Codex Panel](assets/screenshot.webp)

## Connect your notes and Codex

Reference notes and headings with wikilink completion, use `@active` for the open note or `@selection` for selected text, or include the active note automatically. With Daily Notes or Periodic Notes configured, `@today`, `@tomorrow`, and `@yesterday` reference daily notes. Attach files and images or use `/web` to bring readable web content into a prompt. Codex can follow Obsidian links between notes, and links and tags in replies open notes and vault searches.

**Rewrite selection** uses the surrounding note context to propose an edit to selected text, with a diff preview before applying it. For broader file changes, the panel also provides a diff view and patch copying.

## Work with Codex in Obsidian

The panel brings Codex features such as Plan mode and Goals into Obsidian. It shows command and tool activity and subagent progress, and lets you guide or interrupt a running turn.

Answer Codex's questions and review requests for commands, file changes, and additional permissions in the conversation. Connected MCP tools can also present input forms and links for browser-based confirmation.

The panel gives you access to model and permission controls, context and usage information, and conversation compaction. Your existing Codex skills, MCP servers, plugins, and configuration are available alongside these controls.

## Manage conversations

Each panel has its own conversation and draft, so you can work on separate tasks side by side. Regular conversations can be resumed later; temporary conversations stay out of history. Temporary side chats are also available with `/btw`.

From the panel, you can fork from a completed turn, include recent turns from another non-archived conversation in a prompt with `/refer`, and roll back the latest conversation turn.

Search and organize conversations, archive and restore them, and optionally save conversations as Markdown notes in your vault when archiving. Running and unread indicators help you follow work across panels.

## Get started

1. Use Obsidian on desktop with a local vault where Codex can work. Install and authenticate the [Codex CLI](https://developers.openai.com/codex/cli/) first; the supported versions are listed under [Compatibility](#compatibility).
2. In Obsidian's Community plugins browser, search for **Codex Panel**, install it, and enable it. You can also visit the [Community plugin page](https://community.obsidian.md/plugins/codex-panel).
3. Open a note, then run **Codex Panel: Open panel** from the command palette or select the ribbon icon.
4. Try `@active Summarize this note and suggest the next three actions.`

If Obsidian cannot find `codex`, set **Settings → Codex Panel → Codex executable** to its absolute path, such as `/opt/homebrew/bin/codex`.

Use `/doctor` for CLI and connection diagnostics, `/reconnect` to reconnect to Codex, and `/help` for the current command list. Report problems or request features in [GitHub Issues](https://github.com/murashit/codex-panel/issues).

## Compatibility

| Key                               | Version   | Policy                                                                                           |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `manifest.minAppVersion`          | `1.13.0`  | Earliest Obsidian desktop version supported by the current source.                               |
| `codexAppServer.testedCliVersion` | `0.166.0` | Exact CLI patch used to generate and verify bindings; compatibility is tracked by minor version. |

Codex Panel depends on the experimental `codex app-server` API.

## Development

See [Development](docs/development.md) for implementation, review, validation, and contribution guidance.

## License

Codex Panel is licensed under the [Apache License 2.0](LICENSE). The generated app-server TypeScript bindings come from OpenAI Codex CLI; see [NOTICE](NOTICE) for upstream attribution.

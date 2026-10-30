# Codex Panel

Codex Panel brings Codex into Obsidian, so you can work with it alongside your notes using your existing Codex setup.

![Codex Panel](assets/screenshot.webp)

## Connect your notes and Codex

Write prompts as you would an Obsidian note, with wikilink completion for notes and headings. Links and tags in replies work as they do in your Obsidian notes.

Use `@active` to mention the open note and `@selection` to include selected text. `@today`, `@tomorrow`, and `@yesterday` reference daily notes. You can also attach files and images or bring web content into a prompt with `/web`.

**Rewrite selection** proposes changes to selected text using the surrounding note as context, with a diff preview before applying them.

## Work with Codex in Obsidian

You can keep separate conversations open side by side in different panels.

Plan mode and Goals are available as you work with Codex in a conversation. While Codex works, you can follow tool activity and subagent progress, steer or interrupt a turn, and respond to questions and approval requests. When files change, the panel provides a diff view for review.

You can adjust the model and permissions from the panel, check context and usage, and compact the conversation when needed.

For a side question, `/btw` opens a temporary chat. You can also fork from a completed turn or roll back the latest turn. To bring context from another conversation into your prompt, use `/refer` for its recent turns.

## Manage conversations

The **Open thread...** picker lets you search for past conversations and resume earlier work. You can also start a temporary conversation without adding it to your history.

For an overview of your conversations, **Open threads view** opens a dedicated view with running and unread indicators. You can rename and archive conversations directly from this view.

Archiving can also save a conversation as a Markdown note in your vault. Archived conversations remain available to restore later.

## Get started

1. Use Obsidian on desktop with a local vault where Codex can work. Install and authenticate the [Codex CLI](https://developers.openai.com/codex/cli/) first; the supported versions are listed under [Compatibility](#compatibility).
2. In Obsidian's Community plugins browser, search for **Codex Panel**, install it, and enable it. You can also visit the [Community plugin page](https://community.obsidian.md/plugins/codex-panel).
3. Open a note, then run **Codex Panel: Open panel** from the command palette or select the ribbon icon.
4. Try `@active Summarize this note and suggest the next three actions.`

The panel uses your existing Codex skills, MCP servers, and plugins.

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

import { describe, expect, it } from "vitest";
import { transcriptEntriesFromTurnRecords } from "../../../../src/app-server/protocol/turn";
import type { Thread } from "../../../../src/domain/threads/model";
import type { ThreadTranscriptEntry } from "../../../../src/domain/threads/transcript";
import { archivedThreadMarkdown } from "../../../../src/features/threads/workflows/archive-markdown";
import { appServerTurnFixture } from "../../../support/app-server-records";

describe("thread archive export", () => {
  it("writes frontmatter and readable user/codex turns with turn timestamps", () => {
    const output = archivedThreadMarkdown(
      thread({
        id: "thread-12345678",
        name: "Exported thread",
        archived: false,
        transcriptEntries: [
          transcriptEntry("user", "Request", timestamp(2026, 5, 18, 9, 8)),
          transcriptEntry("assistant", "Response", timestamp(2026, 5, 18, 9, 11)),
          transcriptEntry("plan", "<proposed_plan>\nPlan\n</proposed_plan>", timestamp(2026, 5, 18, 9, 11)),
        ],
      }),
      new Date(2026, 4, 18, 9, 8, 7),
    );

    expect(output).toBe(
      [
        "---",
        'title: "Exported thread"',
        'thread_id: "thread-12345678"',
        'created: "2026-05-18"',
        "---",
        "",
        "# Exported thread",
        "",
        "## User - 2026-05-18 09:08",
        "",
        "Request",
        "",
        "## Codex - 2026-05-18 09:11",
        "",
        "Response",
        "",
        "## Proposed plan - 2026-05-18 09:11",
        "",
        "<proposed_plan>",
        "Plan",
        "</proposed_plan>",
        "",
      ].join("\n"),
    );
  });

  it("uses the shared archive title placeholder instead of leaking thread ids", () => {
    const output = archivedThreadMarkdown(thread({ name: null, preview: "" }), new Date(2026, 4, 18));

    expect(output).toContain('title: "Untitled thread"');
    expect(output).toContain("# Untitled thread");
    expect(output).not.toContain("# 019e0182-cb70-7a72-ab48-8bc9d0b0d781");
  });

  it("omits timestamp suffixes when transcript timestamps are missing", () => {
    const output = archivedThreadMarkdown(
      thread({
        transcriptEntries: [transcriptEntry("user", "Older request", null), transcriptEntry("assistant", "Older response", null)],
      }),
      new Date(2026, 4, 18),
    );

    expect(output).toContain("## User\n\nOlder request");
    expect(output).toContain("## Codex\n\nOlder response");
  });

  it("preserves mid-turn guidance after the response it follows despite shared turn timestamps", () => {
    const output = archivedThreadMarkdown(
      thread({
        transcriptEntries: transcriptEntriesFromTurnRecords([
          appServerTurnFixture({
            id: "turn",
            itemsView: "full",
            status: "completed",
            startedAt: timestamp(2026, 5, 18, 9, 0),
            completedAt: timestamp(2026, 5, 18, 9, 5),
            durationMs: 300000,
            items: [
              {
                type: "userMessage",
                id: "prompt",
                clientId: "prompt",
                content: [{ type: "text", text: "Initial request", text_elements: [] }],
              },
              {
                type: "agentMessage",
                id: "commentary",
                text: "Intermediate response",
                phase: "partial_answer",
                memoryCitation: null,
                delivery: null,
                questions: null,
              },
              {
                type: "userMessage",
                id: "steer",
                clientId: "steer",
                content: [{ type: "text", text: "Follow-up guidance", text_elements: [] }],
              },
              {
                type: "agentMessage",
                id: "answer",
                text: "Final response",
                phase: "final_answer",
                memoryCitation: null,
                delivery: null,
                questions: null,
              },
            ],
          }),
        ]),
      }),
      new Date(2026, 4, 18),
    );

    const positions = ["Initial request", "Intermediate response", "Follow-up guidance", "Final response"].map((text) =>
      output.indexOf(text),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("omits frontmatter tags when archive tags are empty", () => {
    const output = archivedThreadMarkdown(thread(), new Date(2026, 4, 18), { archiveExportTags: " , # , " });

    expect(output).not.toContain("tags:");
  });

  it("normalizes archive tags without sorting or changing unmatched quotes", () => {
    const output = archivedThreadMarkdown(thread(), new Date(2026, 4, 18), {
      archiveExportTags: ` "codex" , 'archive', #note/tag, codex, {{title}}, "unfinished `,
    });

    expect(output).toContain('tags: ["codex", "archive", "note/tag", "{{title}}", "\\"unfinished"]');
  });

  it("normalizes exported markdown links for vault and external absolute paths", () => {
    const output = archivedThreadMarkdown(
      thread({
        transcriptEntries: [
          transcriptEntry(
            "assistant",
            [
              "[Vault note](</Users/example/Vault/topics/My Note.md>)",
              "[Vault note with parens](</Users/example/Vault/topics/My (Note).md>)",
              "[Vault note with bare parens](/Users/example/Vault/topics/My_(Note).md)",
              '[**Titled vault note**](/Users/example/Vault/topics/Titled.md "Reference")',
              "[Vault source line](/Users/example/Vault/src/main.ts:12:4#L12)",
              "[Vault config](/Users/example/Vault/vault-config/plugins/codex-panel/main.js)",
              "[Canonical vault config](/Users/example/Vault/docs/../vault-config/plugins/codex-panel/main.js)",
              "[External file](/Users/example/Repos/project/README.md)",
              "[Escaped vault file](/Users/example/Vault/../project/README.md)",
              "[External file with backticks](/Users/example/Repos/project/a\\`b``c.md)",
              "[Relative](topics/Other.md)",
              "[Website](https://example.com/docs)",
              "[Other thread](codex://threads/019abcde-0000-7000-8000-000000000001)",
              "![Image](/Users/example/Repos/project/image.png)",
              "`[Code link](/Users/example/Repos/project/README.md)`",
              "``[Double-fenced code link](/Users/example/Repos/project/README.md)``",
              "```",
              "[Code block link](/Users/example/Repos/project/README.md)",
              "```",
              "~~~",
              "[Tilde code block link](/Users/example/Repos/project/README.md)",
              "~~~",
            ].join("\n"),
            1,
          ),
        ],
      }),
      new Date(2026, 4, 18),
      { vaultPath: "/Users/example/Vault", vaultConfigDir: "vault-config" },
    );

    expect(output).toContain(
      [
        "[Vault note](<topics/My Note.md>)",
        "[Vault note with parens](<topics/My (Note).md>)",
        "[Vault note with bare parens](topics/My_\\(Note\\).md)",
        '[**Titled vault note**](topics/Titled.md "Reference")',
        "[Vault source line](src/main.ts#L12)",
        "Vault config (`/Users/example/Vault/vault-config/plugins/codex-panel/main.js`)",
        "Canonical vault config (`/Users/example/Vault/docs/../vault-config/plugins/codex-panel/main.js`)",
        "External file (`/Users/example/Repos/project/README.md`)",
        "Escaped vault file (`/Users/example/Vault/../project/README.md`)",
        "External file with backticks (```/Users/example/Repos/project/a`b``c.md```)",
        "[Relative](topics/Other.md)",
        "[Website](https://example.com/docs)",
        "[Other thread](codex://threads/019abcde-0000-7000-8000-000000000001)",
        "![Image](/Users/example/Repos/project/image.png)",
        "`[Code link](/Users/example/Repos/project/README.md)`",
        "``[Double-fenced code link](/Users/example/Repos/project/README.md)``",
        "```",
        "[Code block link](/Users/example/Repos/project/README.md)",
        "```",
        "~~~",
        "[Tilde code block link](/Users/example/Repos/project/README.md)",
        "~~~",
      ].join("\n"),
    );
  });

  it("preserves Obsidian syntax outside normalized links", () => {
    const obsidianSyntax = [
      "[[Wiki note]]",
      "![[image.png]]",
      "> [!note] Callout",
      "> body",
      "#tag/path",
      "==highlight==",
      "%% comment %%",
      "- [x] task",
    ].join("\n");
    const output = archivedThreadMarkdown(
      thread({ transcriptEntries: [transcriptEntry("assistant", `${obsidianSyntax}\n[Vault](/Users/example/Vault/Note.md)`, 1)] }),
      new Date(2026, 4, 18),
      { vaultPath: "/Users/example/Vault" },
    );

    expect(output).toContain(obsidianSyntax);
    expect(output).toContain("[Vault](Note.md)");
  });

  it("preserves escaped pipes in table link labels", () => {
    const output = archivedThreadMarkdown(
      thread({
        transcriptEntries: [
          transcriptEntry(
            "assistant",
            "| Vault | External |\n| --- | --- |\n| [A\\|B](/Users/example/Vault/Note.md) | [C\\|D](/Outside/Note.md) |",
            1,
          ),
        ],
      }),
      new Date(2026, 4, 18),
      { vaultPath: "/Users/example/Vault" },
    );

    expect(output).toContain("| [A\\|B](Note.md) | C\\|D (`/Outside/Note.md`) |");
  });
});

function thread(
  overrides: Partial<Thread & { transcriptEntries: ThreadTranscriptEntry[] }> = {},
): Thread & { transcriptEntries: ThreadTranscriptEntry[] } {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ephemeral: false,
    provenance: { kind: "interactive" },
    transcriptEntries: [],
    ...overrides,
  };
}

function timestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

function transcriptEntry(kind: ThreadTranscriptEntry["kind"], text: string, timestampValue: number | null): ThreadTranscriptEntry {
  return { kind, text, timestamp: timestampValue };
}

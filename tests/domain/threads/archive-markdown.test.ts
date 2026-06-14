import { describe, expect, it } from "vitest";

import {
  exportArchivedThreadMarkdown,
  type ArchiveExportAdapter,
  type ArchiveExportSettings,
} from "../../../src/domain/threads/archive-markdown";
import type { Thread } from "../../../src/domain/threads/model";
import { referencedThreadPromptBundle } from "../../../src/domain/threads/reference";
import type { ThreadTranscriptEntry } from "../../../src/domain/threads/transcript";

describe("thread archive export", () => {
  it("writes frontmatter and readable user/codex turns with turn timestamps", async () => {
    const output = await exportedMarkdown(
      thread({
        id: "thread-12345678",
        name: "Exported thread",
        archived: false,
        transcriptEntries: [
          transcriptEntry("user", "依頼です", timestamp(2026, 5, 18, 9, 8)),
          transcriptEntry("assistant", "回答です", timestamp(2026, 5, 18, 9, 11)),
          transcriptEntry("plan", "<proposed_plan>\n計画\n</proposed_plan>", timestamp(2026, 5, 18, 9, 11)),
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
        "依頼です",
        "",
        "## Codex - 2026-05-18 09:11",
        "",
        "回答です",
        "",
        "## Proposed plan - 2026-05-18 09:11",
        "",
        "<proposed_plan>",
        "計画",
        "</proposed_plan>",
        "",
      ].join("\n"),
    );
    expect(output).not.toContain("npm test");
  });

  it("falls back when turn timestamps are missing and uses start time for incomplete agent output", async () => {
    const output = await exportedMarkdown(
      thread({
        transcriptEntries: [
          transcriptEntry("user", "古い依頼", null),
          transcriptEntry("assistant", "古い回答", null),
          transcriptEntry("user", "途中の依頼", timestamp(2026, 5, 18, 10, 1)),
          transcriptEntry("assistant", "途中の回答", timestamp(2026, 5, 18, 10, 1)),
        ],
      }),
      new Date(2026, 4, 18),
    );

    expect(output).toContain("## User\n\n古い依頼");
    expect(output).toContain("## Codex\n\n古い回答");
    expect(output).toContain("## User - 2026-05-18 10:01\n\n途中の依頼");
    expect(output).toContain("## Codex - 2026-05-18 10:01\n\n途中の回答");
  });

  it("exports only the thread history remaining after rollback", async () => {
    const rolledBackUserText = "rollbackされた依頼";
    const rolledBackAssistantText = "rollbackされた回答";
    const remainingEntries = [
      transcriptEntry("user", "残る依頼", timestamp(2026, 5, 18, 9, 0)),
      transcriptEntry("assistant", "残る回答", timestamp(2026, 5, 18, 9, 2)),
    ];
    const rolledBackEntries = [
      transcriptEntry("user", rolledBackUserText, timestamp(2026, 5, 18, 10, 0)),
      transcriptEntry("assistant", rolledBackAssistantText, timestamp(2026, 5, 18, 10, 3)),
    ];
    const output = await exportedMarkdown(
      thread({
        transcriptEntries: remainingEntries,
      }),
      new Date(2026, 4, 18),
    );

    expect(output).toContain("残る依頼");
    expect(output).toContain("残る回答");
    expect(rolledBackEntries).toHaveLength(2);
    expect(output).not.toContain(rolledBackUserText);
    expect(output).not.toContain(rolledBackAssistantText);
  });

  it("hides embedded /refer context and keeps a compact reference line", async () => {
    const { prompt } = referencedThreadPromptBundle(
      thread({ id: "thread-ref", name: "参照元" }),
      [{ userText: "元の依頼", assistantText: "回答" }],
      "続きです",
    );

    const output = await exportedMarkdown(thread({ transcriptEntries: [transcriptEntry("user", prompt, 1)] }), new Date(2026, 4, 18));

    expect(output).toContain("続きです");
    expect(output).toContain("> Referenced: 参照元 (1/20 turns, thread-ref)");
    expect(output).not.toContain("Reference thread history:");
    expect(output).not.toContain("元の依頼");
  });

  it("writes optional frontmatter tags from fixed comma-separated settings", async () => {
    const output = await exportedMarkdown(thread({ name: "Tagged thread" }), new Date(2026, 4, 18), {
      archiveExportTags: '#codex, "archive", codex, {{title}}',
    });

    expect(output).toContain('tags: ["codex", "archive", "{{title}}"]');
  });

  it("omits frontmatter tags when archive tags are empty", async () => {
    const output = await exportedMarkdown(thread(), new Date(2026, 4, 18), { archiveExportTags: " , # , " });

    expect(output).not.toContain("tags:");
  });

  it("normalizes archive tags without sorting or changing unmatched quotes", async () => {
    const output = await exportedMarkdown(thread(), new Date(2026, 4, 18), {
      archiveExportTags: ` "codex" , 'archive', #note/tag, codex, "unfinished `,
    });

    expect(output).toContain('tags: ["codex", "archive", "note/tag", "\\"unfinished"]');
  });

  it("normalizes exported markdown links for vault and external absolute paths", async () => {
    const output = await exportedMarkdown(
      thread({
        transcriptEntries: [
          transcriptEntry(
            "assistant",
            [
              "[Vault note](</Users/showhey/Vault/topics/My Note.md>)",
              "[Vault note with parens](</Users/showhey/Vault/topics/My (Note).md>)",
              "[External file](/Users/showhey/Repos/project/README.md)",
              "[Relative](topics/Other.md)",
              "[Website](https://example.com/docs)",
              "![Image](/Users/showhey/Repos/project/image.png)",
              "`[Code link](/Users/showhey/Repos/project/README.md)`",
              "```",
              "[Code block link](/Users/showhey/Repos/project/README.md)",
              "```",
            ].join("\n"),
            1,
          ),
        ],
      }),
      new Date(2026, 4, 18),
      { vaultPath: "/Users/showhey/Vault" },
    );

    expect(output).toContain(
      [
        "[Vault note](<topics/My Note.md>)",
        "[Vault note with parens](<topics/My (Note).md>)",
        "External file (`/Users/showhey/Repos/project/README.md`)",
        "[Relative](topics/Other.md)",
        "[Website](https://example.com/docs)",
        "![Image](/Users/showhey/Repos/project/image.png)",
        "`[Code link](/Users/showhey/Repos/project/README.md)`",
        "```",
        "[Code block link](/Users/showhey/Repos/project/README.md)",
        "```",
      ].join("\n"),
    );
  });

  it("normalizes exported thread markdown links when vault path is provided", async () => {
    const output = await exportedMarkdown(
      thread({
        transcriptEntries: [
          transcriptEntry(
            "assistant",
            "[Vault](</Users/showhey/Vault/topics/Alpha.md>)\n[External](/Users/showhey/Repos/project/README.md)",
            1,
          ),
        ],
      }),
      new Date(2026, 4, 18),
      { vaultPath: "/Users/showhey/Vault" },
    );

    expect(output).toContain("[Vault](topics/Alpha.md)");
    expect(output).toContain("External (`/Users/showhey/Repos/project/README.md`)");
  });

  it("expands templates, sanitizes paths, creates folders, and preserves existing files", async () => {
    const adapter = new MemoryAdapter(["Codex Archives/2026-05-18/My-Thread- abcdef12.md"]);

    const result = await exportArchivedThreadMarkdown(
      thread({ id: "abcdef12-9999", name: "My/Thread?" }),
      {
        archiveExportFolderTemplate: "Codex Archives/{{date}}",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
        archiveExportTags: "codex, archive",
      },
      adapter,
      new Date(2026, 4, 18, 9, 8, 7),
    );

    expect(result.path).toBe("Codex Archives/2026-05-18/My-Thread- abcdef12 2.md");
    expect(adapter.folders).toContain("Codex Archives");
    expect(adapter.folders).toContain("Codex Archives/2026-05-18");
    expect(adapter.files.get(result.path)).toContain('thread_id: "abcdef12-9999"');
    expect(adapter.files.get(result.path)).toContain('tags: ["codex", "archive"]');
  });

  it("rejects vault-external or empty export paths", async () => {
    const adapter = new MemoryAdapter();
    await expect(
      exportArchivedThreadMarkdown(
        thread(),
        { archiveExportFolderTemplate: "../outside", archiveExportFilenameTemplate: "{{title}}.md" },
        adapter,
      ),
    ).rejects.toThrow("relative path segments");
    await expect(
      exportArchivedThreadMarkdown(thread(), { archiveExportFolderTemplate: "Exports", archiveExportFilenameTemplate: "   " }, adapter),
    ).rejects.toThrow("empty filename");
  });
});

async function exportedMarkdown(
  source: Thread & { transcriptEntries: ThreadTranscriptEntry[] },
  now: Date,
  settings: Partial<ArchiveExportSettings> = {},
): Promise<string> {
  const adapter = new MemoryAdapter();
  const result = await exportArchivedThreadMarkdown(
    source,
    {
      archiveExportFolderTemplate: "Exports",
      archiveExportFilenameTemplate: "{{title}}",
      ...settings,
    },
    adapter,
    now,
  );
  const markdown = adapter.files.get(result.path);
  if (markdown === undefined) throw new Error(`Expected exported markdown at ${result.path}`);
  return markdown;
}

class MemoryAdapter implements ArchiveExportAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  constructor(existingFiles: string[] = []) {
    for (const file of existingFiles) {
      this.files.set(file, "");
      const parts = file.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        this.folders.add(parts.slice(0, index).join("/"));
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
}

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

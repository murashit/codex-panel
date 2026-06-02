import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { ThreadItem } from "../../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";
import {
  exportArchivedThreadMarkdown,
  markdownFromThread,
  normalizeExportedMarkdownLinks,
  normalizedArchiveTags,
  type ArchiveExportAdapter,
} from "../../../src/domain/threads/export";
import { referencedThreadPrompt } from "../../../src/domain/threads/reference";

describe("thread archive export", () => {
  it("writes frontmatter and readable user/codex turns with turn timestamps", () => {
    const output = markdownFromThread(
      thread({
        id: "thread-12345678",
        name: "Exported thread",
        turns: [
          turn(
            [
              userMessage("user-1", "依頼です"),
              commandItem("cmd-1"),
              assistantMessage("assistant-1", "回答です"),
              planItem("plan-1", "<proposed_plan>\n計画\n</proposed_plan>"),
            ],
            {
              startedAt: timestamp(2026, 5, 18, 9, 8),
              completedAt: timestamp(2026, 5, 18, 9, 11),
            },
          ),
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

  it("falls back when turn timestamps are missing and uses start time for incomplete agent output", () => {
    const output = markdownFromThread(
      thread({
        turns: [
          turn([userMessage("user-1", "古い依頼"), assistantMessage("assistant-1", "古い回答")], {
            startedAt: null,
            completedAt: null,
          }),
          turn([userMessage("user-2", "途中の依頼"), assistantMessage("assistant-2", "途中の回答")], {
            startedAt: timestamp(2026, 5, 18, 10, 1),
            completedAt: null,
          }),
        ],
      }),
      new Date(2026, 4, 18),
    );

    expect(output).toContain("## User\n\n古い依頼");
    expect(output).toContain("## Codex\n\n古い回答");
    expect(output).toContain("## User - 2026-05-18 10:01\n\n途中の依頼");
    expect(output).toContain("## Codex - 2026-05-18 10:01\n\n途中の回答");
  });

  it("exports only the thread history remaining after rollback", () => {
    const rolledBackUserText = "rollbackされた依頼";
    const rolledBackAssistantText = "rollbackされた回答";
    const remainingTurn = turn([userMessage("user-1", "残る依頼"), assistantMessage("assistant-1", "残る回答")], {
      startedAt: timestamp(2026, 5, 18, 9, 0),
      completedAt: timestamp(2026, 5, 18, 9, 2),
    });
    const rolledBackTurn = turn([userMessage("user-2", rolledBackUserText), assistantMessage("assistant-2", rolledBackAssistantText)], {
      startedAt: timestamp(2026, 5, 18, 10, 0),
      completedAt: timestamp(2026, 5, 18, 10, 3),
    });
    const output = markdownFromThread(
      thread({
        turns: [remainingTurn],
      }),
      new Date(2026, 4, 18),
    );

    expect(output).toContain("残る依頼");
    expect(output).toContain("残る回答");
    expect(rolledBackTurn.items).toHaveLength(2);
    expect(output).not.toContain(rolledBackUserText);
    expect(output).not.toContain(rolledBackAssistantText);
  });

  it("hides embedded /refer context and keeps a compact reference line", () => {
    const prompt = referencedThreadPrompt(
      thread({ id: "thread-ref", name: "参照元" }),
      [{ userText: "元の依頼", assistantText: "回答" }],
      "続きです",
    );

    const output = markdownFromThread(thread({ turns: [turn([userMessage("user-1", prompt)])] }), new Date(2026, 4, 18));

    expect(output).toContain("続きです");
    expect(output).toContain("> Referenced: 参照元 (1/20 turns, thread-ref)");
    expect(output).not.toContain("Reference thread history:");
    expect(output).not.toContain("元の依頼");
  });

  it("writes optional frontmatter tags from fixed comma-separated settings", () => {
    const output = markdownFromThread(thread({ name: "Tagged thread" }), new Date(2026, 4, 18), {
      archiveExportTags: '#codex, "archive", codex, {{title}}',
    });

    expect(output).toContain('tags: ["codex", "archive", "{{title}}"]');
  });

  it("omits frontmatter tags when archive tags are empty", () => {
    const output = markdownFromThread(thread(), new Date(2026, 4, 18), { archiveExportTags: " , # , " });

    expect(output).not.toContain("tags:");
  });

  it("normalizes archive tags without sorting or changing unmatched quotes", () => {
    expect(normalizedArchiveTags(` "codex" , 'archive', #note/tag, codex, "unfinished `)).toEqual([
      "codex",
      "archive",
      "note/tag",
      '"unfinished',
    ]);
  });

  it("normalizes exported markdown links for vault and external absolute paths", () => {
    const output = normalizeExportedMarkdownLinks(
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
      "/Users/showhey/Vault",
    );

    expect(output).toBe(
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

  it("normalizes exported thread markdown links when vault path is provided", () => {
    const output = markdownFromThread(
      thread({
        turns: [
          turn([
            assistantMessage(
              "assistant-1",
              "[Vault](</Users/showhey/Vault/topics/Alpha.md>)\n[External](/Users/showhey/Repos/project/README.md)",
            ),
          ]),
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

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    sessionId: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    forkedFromId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp",
    cliVersion: "codex-cli 0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function turn(items: ThreadItem[], overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
    ...overrides,
  };
}

function timestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

function userMessage(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function assistantMessage(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: null, memoryCitation: null };
}

function planItem(id: string, text: string): ThreadItem {
  return { type: "plan", id, text };
}

function commandItem(id: string): ThreadItem {
  return {
    type: "commandExecution",
    id,
    command: "npm test",
    cwd: "/tmp",
    processId: null,
    source: "agent",
    status: "completed",
    commandActions: [],
    aggregatedOutput: "ok",
    exitCode: 0,
    durationMs: 100,
  };
}

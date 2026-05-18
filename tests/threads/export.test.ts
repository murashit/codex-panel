import { describe, expect, it } from "vitest";

import type { Thread } from "../../src/generated/app-server/v2/Thread";
import type { ThreadItem } from "../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../src/generated/app-server/v2/Turn";
import { exportArchivedThreadMarkdown, markdownFromThread, type ArchiveExportAdapter } from "../../src/threads/export";
import { referencedThreadPrompt } from "../../src/threads/reference";

describe("thread archive export", () => {
  it("writes frontmatter and readable user/codex turns without turn timestamps", () => {
    const output = markdownFromThread(
      thread({
        id: "thread-12345678",
        name: "Exported thread",
        turns: [
          turn([
            userMessage("user-1", "依頼です"),
            commandItem("cmd-1"),
            assistantMessage("assistant-1", "回答です"),
            planItem("plan-1", "<proposed_plan>\n計画\n</proposed_plan>"),
          ]),
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
        "## User",
        "",
        "依頼です",
        "",
        "## Codex",
        "",
        "回答です",
        "",
        "## Proposed plan",
        "",
        "<proposed_plan>",
        "計画",
        "</proposed_plan>",
        "",
      ].join("\n"),
    );
    expect(output).not.toContain("09:08");
    expect(output).not.toContain("npm test");
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
    expect(output).not.toContain("Reference conversation:");
    expect(output).not.toContain("元の依頼");
  });

  it("expands templates, sanitizes paths, creates folders, and preserves existing files", async () => {
    const adapter = new MemoryAdapter(["Codex Archives/2026-05-18/My-Thread- abcdef12.md"]);

    const result = await exportArchivedThreadMarkdown(
      thread({ id: "abcdef12-9999", name: "My/Thread?" }),
      {
        archiveExportFolderTemplate: "Codex Archives/{{date}}",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
      adapter,
      new Date(2026, 4, 18, 9, 8, 7),
    );

    expect(result.path).toBe("Codex Archives/2026-05-18/My-Thread- abcdef12 2.md");
    expect(adapter.folders).toContain("Codex Archives");
    expect(adapter.folders).toContain("Codex Archives/2026-05-18");
    expect(adapter.files.get(result.path)).toContain('thread_id: "abcdef12-9999"');
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

function turn(items: ThreadItem[]): Turn {
  return {
    id: "turn-1",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
  };
}

function userMessage(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, content: [{ type: "text", text, text_elements: [] }] };
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

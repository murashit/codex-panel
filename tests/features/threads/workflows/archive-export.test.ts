import { describe, expect, it } from "vitest";
import type { ThreadTranscript, ThreadTranscriptEntry } from "../../../../src/domain/threads/transcript";
import { type ArchiveExportDestination, exportArchivedThreadMarkdown } from "../../../../src/features/threads/workflows/archive-export";

describe("archive export workflow", () => {
  it("uses a fixed folder path and expands the filename template", async () => {
    const destination = new MemoryDestination(["Codex Archives/{{date}}/My-Thread- abcdef12.md"]);

    const result = await exportArchivedThreadMarkdown(
      thread({ id: "abcdef12-9999", name: "My/Thread?" }),
      {
        archiveExportFolderTemplate: "Codex Archives/{{date}}",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
        archiveExportTags: "codex, archive",
      },
      destination,
      new Date(2026, 4, 18, 9, 8, 7),
    );

    expect(result.path).toBe("Codex Archives/{{date}}/My-Thread- abcdef12 2.md");
    expect(destination.folders).toContain("Codex Archives");
    expect(destination.folders).toContain("Codex Archives/{{date}}");
    expect(destination.files.get(result.path)).toContain('thread_id: "abcdef12-9999"');
    expect(destination.files.get(result.path)).toContain('tags: ["codex", "archive"]');
  });

  it("rejects vault-external or empty export paths", async () => {
    const destination = new MemoryDestination();
    await expect(
      exportArchivedThreadMarkdown(
        thread(),
        { archiveExportFolderTemplate: "../outside", archiveExportFilenameTemplate: "{{title}}.md" },
        destination,
      ),
    ).rejects.toThrow("relative path segments");
    await expect(
      exportArchivedThreadMarkdown(thread(), { archiveExportFolderTemplate: "Exports", archiveExportFilenameTemplate: "   " }, destination),
    ).rejects.toThrow("empty filename");
  });

  it("normalizes generated vault paths through the archive destination", async () => {
    const destination = new MemoryDestination([], (path) =>
      path
        .replace(/\u00a0/g, " ")
        .replace(/\/+/g, "/")
        .normalize(),
    );

    const result = await exportArchivedThreadMarkdown(
      thread({ name: "Thread\u00a0Cafe\u0301" }),
      {
        archiveExportFolderTemplate: "Codex\u00a0Archives/Cafe\u0301",
        archiveExportFilenameTemplate: "{{title}}",
      },
      destination,
      new Date(2026, 4, 18, 9, 8, 7),
    );

    expect(result.path).toBe("Codex Archives/Café/Thread Café.md");
    expect(destination.folders).toContain("Codex Archives/Café");
    expect(destination.files.has(result.path)).toBe(true);
  });
});

function thread(overrides: Partial<ThreadTranscript> = {}): ThreadTranscript {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: "Thread",
    archived: false,
    provenance: { kind: "interactive" },
    transcriptEntries: [transcriptEntry("user", "Hello", 1)],
    ...overrides,
  };
}

function transcriptEntry(kind: ThreadTranscriptEntry["kind"], text: string, timestamp: number | null): ThreadTranscriptEntry {
  return { kind, text, timestamp };
}

class MemoryDestination implements ArchiveExportDestination {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly normalizePath: (path: string) => string;

  constructor(existingFiles: string[] = [], normalizePath?: (path: string) => string) {
    this.normalizePath = normalizePath ?? ((path) => path);
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

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async createMarkdownFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

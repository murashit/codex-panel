import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import { archiveThreadOnAppServer } from "../../src/app-server/services/thread-archive";
import type { ArchiveExportDestination } from "../../src/app-server/services/thread-archive-markdown";
import { DEFAULT_SETTINGS } from "../../src/settings/model";

describe("thread archive operation", () => {
  it("exports markdown before archiving when requested", async () => {
    const client = fakeClient();
    const destination = archiveDestination();

    const result = await archiveThreadOnAppServer(client, "thread", {
      settings: {
        ...DEFAULT_SETTINGS,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
      vaultPath: "/vault",
      vaultConfigDir: "vault-config",
      archiveDestination: () => destination,
      saveMarkdown: true,
    });

    expect(client.readThread).toHaveBeenCalledWith("thread", true);
    expect(destination.createMarkdownFile).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client.archiveThread).toHaveBeenCalledWith("thread");
    expect(result).toEqual({ exportedPath: "Archive/Archived Thread abcdef12.md" });
    expect(callOrder(destination.createMarkdownFile)).toBeLessThan(callOrder(client.archiveThread));
  });

  it("archives without reading transcript history when markdown export is disabled", async () => {
    const client = fakeClient();
    const archiveDestinationFactory = vi.fn(() => archiveDestination());

    await expect(
      archiveThreadOnAppServer(client, "thread", {
        settings: DEFAULT_SETTINGS,
        vaultPath: "/vault",
        vaultConfigDir: "vault-config",
        archiveDestination: archiveDestinationFactory,
        saveMarkdown: false,
      }),
    ).resolves.toEqual({ exportedPath: null });

    expect(client.readThread).not.toHaveBeenCalled();
    expect(archiveDestinationFactory).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("thread");
  });
});

function fakeClient(): AppServerClient & {
  readThread: ReturnType<typeof vi.fn>;
  archiveThread: ReturnType<typeof vi.fn>;
} {
  return {
    readThread: vi.fn().mockResolvedValue({ thread: archivedThread() }),
    archiveThread: vi.fn().mockResolvedValue({}),
  } as unknown as AppServerClient & {
    readThread: ReturnType<typeof vi.fn>;
    archiveThread: ReturnType<typeof vi.fn>;
  };
}

function archiveDestination(): ArchiveExportDestination & {
  exists: ReturnType<typeof vi.fn<ArchiveExportDestination["exists"]>>;
  createFolder: ReturnType<typeof vi.fn<ArchiveExportDestination["createFolder"]>>;
  createMarkdownFile: ReturnType<typeof vi.fn<ArchiveExportDestination["createMarkdownFile"]>>;
} {
  return {
    normalizePath: (path) => path,
    exists: vi.fn<ArchiveExportDestination["exists"]>().mockResolvedValue(false),
    createFolder: vi.fn<ArchiveExportDestination["createFolder"]>().mockResolvedValue(undefined),
    createMarkdownFile: vi.fn<ArchiveExportDestination["createMarkdownFile"]>().mockResolvedValue(undefined),
  };
}

function archivedThread(): ThreadRecord {
  return {
    id: "abcdef12-9999",
    sessionId: "abcdef12-9999",
    preview: "Archived Thread",
    source: { kind: "local" },
    cwd: "/vault",
    createdAt: 1,
    updatedAt: 2,
    name: "Archived Thread",
    status: "idle",
    gitInfo: null,
    turns: [],
  };
}

function callOrder(fn: ReturnType<typeof vi.fn>): number {
  return fn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
}

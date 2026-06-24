import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import { archiveThreadOnAppServer } from "../../src/app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../src/domain/threads/archive-markdown";
import { DEFAULT_SETTINGS } from "../../src/settings/model";

describe("thread archive operation", () => {
  it("exports markdown before archiving when requested", async () => {
    const client = fakeClient();
    const adapter = archiveAdapter();

    const result = await archiveThreadOnAppServer(client, "thread", {
      settings: {
        ...DEFAULT_SETTINGS,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
      vaultPath: "/vault",
      vaultConfigDir: "vault-config",
      archiveAdapter: () => adapter,
      saveMarkdown: true,
    });

    expect(client.readThread).toHaveBeenCalledWith("thread", true);
    expect(adapter.write).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client.archiveThread).toHaveBeenCalledWith("thread");
    expect(result).toEqual({ exportedPath: "Archive/Archived Thread abcdef12.md" });
    expect(callOrder(adapter.write)).toBeLessThan(callOrder(client.archiveThread));
  });

  it("archives without reading transcript history when markdown export is disabled", async () => {
    const client = fakeClient();
    const archiveAdapterFactory = vi.fn(() => archiveAdapter());

    await expect(
      archiveThreadOnAppServer(client, "thread", {
        settings: DEFAULT_SETTINGS,
        vaultPath: "/vault",
        vaultConfigDir: "vault-config",
        archiveAdapter: archiveAdapterFactory,
        saveMarkdown: false,
      }),
    ).resolves.toEqual({ exportedPath: null });

    expect(client.readThread).not.toHaveBeenCalled();
    expect(archiveAdapterFactory).not.toHaveBeenCalled();
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

function archiveAdapter(): ArchiveExportAdapter & {
  exists: ReturnType<typeof vi.fn<ArchiveExportAdapter["exists"]>>;
  mkdir: ReturnType<typeof vi.fn<ArchiveExportAdapter["mkdir"]>>;
  write: ReturnType<typeof vi.fn<ArchiveExportAdapter["write"]>>;
} {
  return {
    exists: vi.fn<ArchiveExportAdapter["exists"]>().mockResolvedValue(false),
    mkdir: vi.fn<ArchiveExportAdapter["mkdir"]>().mockResolvedValue(undefined),
    write: vi.fn<ArchiveExportAdapter["write"]>().mockResolvedValue(undefined),
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

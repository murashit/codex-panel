import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/connection/client";
import type { ArchiveThreadResult } from "../../../src/app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../../src/app-server/services/thread-archive-markdown";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { ThreadOperations, type ThreadOperationsHost } from "../../../src/features/threads/thread-operations";

const archiveMock = vi.hoisted(() => ({
  archiveThreadOnAppServer: vi.fn(),
}));

vi.mock("../../../src/app-server/services/thread-archive", () => ({
  archiveThreadOnAppServer: archiveMock.archiveThreadOnAppServer,
}));

describe("ThreadOperations", () => {
  it("renames a thread and notifies shared surfaces after success", async () => {
    const { operations, client, catalog } = operationsFixture();

    await expect(operations.renameThread("thread", "  Saved   title  ")).resolves.toEqual({ name: "Saved title" });

    expect(client?.setThreadName).toHaveBeenCalledWith("thread", "Saved title");
    expect(catalog.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Saved title");
  });

  it("can skip rename publication when the caller invalidates the save", async () => {
    const { operations, catalog } = operationsFixture();

    await operations.renameThread("thread", "Generated title", { shouldPublish: () => false });

    expect(catalog.notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it("archives a thread, reports exported markdown, and notifies shared surfaces", async () => {
    const { operations, catalog, notice } = operationsFixture();
    archiveMock.archiveThreadOnAppServer.mockResolvedValueOnce({ exportedPath: "Archive/thread.md" } satisfies ArchiveThreadResult);

    await expect(operations.archiveThread("thread", { saveMarkdown: true, closeOpenPanels: true })).resolves.toEqual({
      exportedPath: "Archive/thread.md",
    });

    expect(notice).toHaveBeenCalledWith("Saved archived thread to Archive/thread.md.");
    expect(catalog.notifyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });

  it("does not notify surfaces when an operation has no current client", async () => {
    const { operations, catalog } = operationsFixture({ client: null });

    await expect(operations.renameThread("thread", "Title")).resolves.toBeNull();
    await expect(operations.archiveThread("thread")).resolves.toBeNull();

    expect(catalog.notifyThreadRenamed).not.toHaveBeenCalled();
    expect(catalog.notifyThreadArchived).not.toHaveBeenCalled();
  });
});

function operationsFixture(options: { client?: MockClient | null } = {}) {
  archiveMock.archiveThreadOnAppServer.mockReset();
  archiveMock.archiveThreadOnAppServer.mockResolvedValue({ exportedPath: null } satisfies ArchiveThreadResult);
  const client = options.client === undefined ? clientMock() : options.client;
  const catalog = {
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    refreshFromOpenSurface: vi.fn(),
  };
  const notice = vi.fn();
  const host: ThreadOperationsHost = {
    connection: {
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      currentClient: () => client as AppServerClient | null,
    },
    settings: {
      current: () => ({ ...DEFAULT_SETTINGS, archiveExportEnabled: false }),
      vaultPath: "/vault",
    },
    archiveAdapter: () => archiveAdapterMock(),
    catalog,
    notice,
  };
  return { operations: new ThreadOperations(host), client, catalog, notice };
}

type MockClient = ReturnType<typeof clientMock>;

function clientMock() {
  return {
    setThreadName: vi.fn().mockResolvedValue({}),
    archiveThread: vi.fn().mockResolvedValue({}),
  };
}

function archiveAdapterMock(): ArchiveExportAdapter {
  return {
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

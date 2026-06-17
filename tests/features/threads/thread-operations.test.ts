import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/connection/client";
import type { ArchiveThreadResult } from "../../../src/app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../../src/domain/threads/archive-markdown";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { createThreadOperations, type ThreadOperationsHost } from "../../../src/features/threads/thread-operations";

const archiveMock = vi.hoisted(() => ({
  archiveThreadOnAppServer: vi.fn(),
}));

vi.mock("../../../src/app-server/services/thread-archive", () => ({
  archiveThreadOnAppServer: archiveMock.archiveThreadOnAppServer,
}));

describe("ThreadOperations", () => {
  it("renames a thread and notifies shared surfaces after success", async () => {
    const { operations, client, catalog } = operationsFixture();

    await expect(operations.renameThread("thread", "  Saved   title  ")).resolves.toBe(true);

    expect(client?.setThreadName).toHaveBeenCalledWith("thread", "Saved title");
    expect(catalog.recordThreadRenamed).toHaveBeenCalledWith("thread", "Saved title");
  });

  it("can skip rename publication when the caller invalidates the save", async () => {
    const { operations, catalog } = operationsFixture();

    await operations.renameThread("thread", "Generated title", { shouldPublish: () => false });

    expect(catalog.recordThreadRenamed).not.toHaveBeenCalled();
  });

  it("archives a thread, reports exported markdown, and notifies shared surfaces", async () => {
    const { operations, catalog, notice } = operationsFixture();
    archiveMock.archiveThreadOnAppServer.mockResolvedValueOnce({ exportedPath: "Archive/thread.md" } satisfies ArchiveThreadResult);

    await expect(operations.archiveThread("thread", { saveMarkdown: true, closeOpenPanels: true })).resolves.toEqual({
      exportedPath: "Archive/thread.md",
    });

    expect(notice).toHaveBeenCalledWith("Saved archived thread to Archive/thread.md.");
    expect(catalog.recordThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });

  it("does not notify surfaces when an operation has no current client", async () => {
    const { operations, catalog } = operationsFixture({ client: null });

    await expect(operations.renameThread("thread", "Title")).rejects.toThrow("No current client.");
    await expect(operations.archiveThread("thread")).rejects.toThrow("No current client.");

    expect(catalog.recordThreadRenamed).not.toHaveBeenCalled();
    expect(catalog.recordThreadArchived).not.toHaveBeenCalled();
  });

  it("does not publish stale rename results after the current client changes", async () => {
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient: MockClient | null = firstClient;
    const { operations, catalog } = operationsFixture({ client: () => currentClient });
    firstClient.setThreadName.mockImplementationOnce(async () => {
      currentClient = secondClient;
    });

    await expect(operations.renameThread("thread", "Title")).rejects.toThrow("Client changed.");

    expect(catalog.recordThreadRenamed).not.toHaveBeenCalled();
  });

  it("does not publish stale archive results after the current client changes", async () => {
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient: MockClient | null = firstClient;
    const { operations, catalog } = operationsFixture({ client: () => currentClient });
    archiveMock.archiveThreadOnAppServer.mockImplementationOnce(async () => {
      currentClient = secondClient;
      return { exportedPath: null } satisfies ArchiveThreadResult;
    });

    await expect(operations.archiveThread("thread")).rejects.toThrow("Client changed.");

    expect(catalog.recordThreadArchived).not.toHaveBeenCalled();
  });
});

function operationsFixture(options: { client?: MockClient | null | (() => MockClient | null) } = {}) {
  archiveMock.archiveThreadOnAppServer.mockReset();
  archiveMock.archiveThreadOnAppServer.mockResolvedValue({ exportedPath: null } satisfies ArchiveThreadResult);
  const configuredClient = options.client === undefined ? clientMock() : options.client;
  const currentClient = typeof configuredClient === "function" ? configuredClient : () => configuredClient;
  const catalog = {
    recordThreadArchived: vi.fn(),
    recordThreadRenamed: vi.fn(),
  };
  const notice = vi.fn();
  const host: ThreadOperationsHost = {
    clientAccess: {
      withClient: async (operation) => {
        const client = currentClient() as AppServerClient | null;
        if (!client) throw new Error("No current client.");
        const result = await operation(client);
        if ((currentClient() as AppServerClient | null) !== client) throw new Error("Client changed.");
        return result;
      },
    },
    archiveExport: {
      settings: () => ({
        archiveExportFolderTemplate: DEFAULT_SETTINGS.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: DEFAULT_SETTINGS.archiveExportFilenameTemplate,
        archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
      }),
      enabled: () => false,
      vaultPath: "/vault",
    },
    archiveAdapter: () => archiveAdapterMock(),
    catalog,
    notice,
  };
  return { operations: createThreadOperations(host), client: currentClient(), catalog, notice };
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

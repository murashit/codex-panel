import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { Thread } from "../../../../src/domain/threads/model";
import { createThreadOperationsTransport } from "../../../../src/features/threads/app-server/workflow-transports";
import type { ArchiveExportDestination } from "../../../../src/features/threads/workflows/archive-export";
import { createThreadNameMutationCoordinator } from "../../../../src/features/threads/workflows/thread-name-mutation-coordinator";
import {
  type ArchiveThreadResult,
  createThreadOperations,
  type ThreadOperationsHost,
} from "../../../../src/features/threads/workflows/thread-operations";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { deferred } from "../../../support/async";
import { legacyTurnContextManifestText } from "../../../support/legacy-turn-context-manifest";

describe("ThreadOperations", () => {
  it("renames a thread and notifies shared surfaces after success", async () => {
    const { operations, client, catalog } = operationsFixture();

    await expect(operations.renameThread("thread", "  Saved   title  ")).resolves.toBe(true);

    expect(client?.request).toHaveBeenCalledWith("thread/name/set", { threadId: "thread", name: "Saved title" });
    expect(catalog.apply).toHaveBeenCalledWith({ type: "thread-renamed", threadId: "thread", name: "Saved title" });
  });

  it("can skip rename publication when the caller invalidates the save", async () => {
    const { operations, catalog } = operationsFixture();

    await operations.renameThread("thread", "Generated title", { shouldPublish: () => false });

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("serializes successive names for the same thread", async () => {
    const generatedSave = deferred<object>();
    const client = clientMock();
    client.request.mockImplementationOnce(async (method: string) => {
      if (method !== "thread/name/set") throw new Error(`Unexpected app-server request: ${method}`);
      return generatedSave.promise;
    });
    const { operations } = operationsFixture({ client });

    const generated = operations.renameThread("thread", "Generated title");
    await Promise.resolve();
    const firstManual = operations.renameThread("thread", "First manual title");
    const latestManual = operations.renameThread("thread", "Latest manual title");
    await Promise.resolve();

    expect(client.request).toHaveBeenCalledTimes(1);
    generatedSave.resolve({});
    await Promise.all([generated, firstManual, latestManual]);

    expect(client.request).toHaveBeenNthCalledWith(1, "thread/name/set", { threadId: "thread", name: "Generated title" });
    expect(client.request).toHaveBeenNthCalledWith(2, "thread/name/set", { threadId: "thread", name: "First manual title" });
    expect(client.request).toHaveBeenNthCalledWith(3, "thread/name/set", { threadId: "thread", name: "Latest manual title" });
  });

  it("archives a thread, reports exported markdown, and notifies shared surfaces", async () => {
    const { operations, catalog, notice, client, archiveDestination } = operationsFixture();

    await expect(operations.archiveThread("thread", { saveMarkdown: true })).resolves.toEqual({
      exportedPath: "Archive/Archived Thread abcdef12.md",
    });

    expect(client?.request).toHaveBeenCalledWith("thread/read", { threadId: "thread", includeTurns: true });
    expect(archiveDestination.createMarkdownFile).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client?.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
    expect(callOrder(archiveDestination.createMarkdownFile)).toBeLessThan(requestCallOrder(client, "thread/archive"));
    expect(notice).toHaveBeenCalledWith("Saved archived thread to Archive/Archived Thread abcdef12.md.");
    expect(catalog.apply).toHaveBeenCalledWith({
      type: "thread-archived",
      threadId: "thread",
    });
  });

  it("resolves persisted reference titles before archive export", async () => {
    const client = clientMock();
    const clientId = "local-user-1-seed-1-1";
    const manifest = legacyTurnContextManifestText({
      version: 2,
      submissionId: clientId,
      contexts: [
        {
          kind: "referencedThread",
          id: `${clientId}.00`,
          parts: 1,
          sourceBytes: 7,
          includedBytes: 7,
          threadId: "thread-reference",
          includedTurns: 1,
          turnLimit: 20,
          omittedTurns: 0,
          truncated: false,
        },
      ],
    });
    client.request.mockImplementation((method: string, params: { threadId: string; name?: string }) => {
      if (method === "thread/read") {
        return Promise.resolve({
          thread: {
            ...archivedThread(),
            turns: [
              {
                id: "turn",
                itemsView: "full",
                status: "completed",
                error: null,
                startedAt: 1,
                completedAt: 2,
                durationMs: 1,
                items: [
                  {
                    type: "userMessage",
                    id: "user",
                    clientId,
                    content: [
                      { type: "text", text: "continue", text_elements: [] },
                      { type: "text", text: `\n${manifest}`, text_elements: [] },
                    ],
                  },
                ],
              },
            ],
          },
        });
      }
      if (method === "thread/archive") return Promise.resolve({});
      throw new Error(`Unexpected app-server request: ${method} ${params.threadId}`);
    });
    const reference: Thread = {
      id: "thread-reference",
      name: "Readable reference title",
      preview: "",
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    };
    const { operations, archiveDestination } = operationsFixture({ client, referenceThreads: [reference] });

    await operations.archiveThread("thread", { saveMarkdown: true });

    expect(archiveDestination.createMarkdownFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("> Referenced: Readable reference title"),
    );
  });

  it("archives without reading transcript history when markdown export is disabled", async () => {
    const { operations, client, archiveDestinationFactory, archiveExportSettings } = operationsFixture();

    await expect(operations.archiveThread("thread")).resolves.toEqual({ exportedPath: null } satisfies ArchiveThreadResult);

    expect(requestMethods(client)).not.toContain("thread/read");
    expect(archiveExportSettings).not.toHaveBeenCalled();
    expect(archiveDestinationFactory).not.toHaveBeenCalled();
    expect(client?.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
  });

  it("does not notify surfaces when an operation has no current client", async () => {
    const { operations, catalog } = operationsFixture({ client: null });

    await expect(operations.renameThread("thread", "Title")).rejects.toThrow("No current client.");
    await expect(operations.archiveThread("thread")).rejects.toThrow("No current client.");

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("does not publish stale rename results after the current client changes", async () => {
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient: MockClient | null = firstClient;
    const { operations, catalog } = operationsFixture({ client: () => currentClient });
    firstClient.request.mockImplementationOnce(async (method: string) => {
      if (method !== "thread/name/set") throw new Error(`Unexpected app-server request: ${method}`);
      currentClient = secondClient;
      return {};
    });

    await expect(operations.renameThread("thread", "Title")).rejects.toThrow("Client changed.");

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("does not publish stale archive results after the current client changes", async () => {
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient: MockClient | null = firstClient;
    const { operations, catalog } = operationsFixture({ client: () => currentClient });
    firstClient.request.mockImplementationOnce(async (method: string) => {
      if (method !== "thread/archive") throw new Error(`Unexpected app-server request: ${method}`);
      currentClient = secondClient;
      return {};
    });

    await expect(operations.archiveThread("thread")).rejects.toThrow("Client changed.");

    expect(catalog.apply).not.toHaveBeenCalled();
  });
});

function operationsFixture(options: { client?: MockClient | null | (() => MockClient | null); referenceThreads?: readonly Thread[] } = {}) {
  const configuredClient = options.client === undefined ? clientMock() : options.client;
  const currentClient = typeof configuredClient === "function" ? configuredClient : () => configuredClient;
  const archiveDestination = archiveDestinationMock();
  const archiveDestinationFactory = vi.fn(() => archiveDestination);
  const archiveExportSettings = vi.fn(() => ({
    archiveExportFolderTemplate: "Archive",
    archiveExportFilenameTemplate: "{{title}} {{shortId}}",
    archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
  }));
  const catalog = {
    apply: vi.fn(),
  };
  const notice = vi.fn();
  const host: ThreadOperationsHost = {
    transport: createThreadOperationsTransport({
      withClient: async (operation) => {
        const client = currentClient() as AppServerClient | null;
        if (!client) throw new Error("No current client.");
        const result = await operation(client);
        if ((currentClient() as AppServerClient | null) !== client) throw new Error("Client changed.");
        return result;
      },
    }),
    nameMutations: createThreadNameMutationCoordinator(),
    archiveExport: {
      settings: archiveExportSettings,
      enabled: () => false,
      vaultPath: "/vault",
      vaultConfigDir: "vault-config",
    },
    archiveDestination: archiveDestinationFactory,
    catalog,
    referenceThreads: () => options.referenceThreads ?? [],
    notice,
  };
  return {
    operations: createThreadOperations(host),
    client: currentClient(),
    archiveDestination,
    archiveDestinationFactory,
    archiveExportSettings,
    catalog,
    notice,
  };
}

type MockClient = ReturnType<typeof clientMock>;

function clientMock() {
  return {
    request: vi.fn((method: string, params: { threadId: string; name?: string }) => {
      if (method === "thread/name/set") return Promise.resolve({ threadId: params.threadId, name: params.name });
      if (method === "thread/read") return Promise.resolve({ thread: archivedThread() });
      if (method === "thread/archive") return Promise.resolve({});
      throw new Error(`Unexpected app-server request: ${method}`);
    }),
  };
}

function archiveDestinationMock(): ArchiveExportDestination & {
  createMarkdownFile: ReturnType<typeof vi.fn<ArchiveExportDestination["createMarkdownFile"]>>;
} {
  return {
    normalizePath: (path) => path,
    exists: vi.fn().mockResolvedValue(false),
    createFolder: vi.fn().mockResolvedValue(undefined),
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

function requestMethods(client: { request: ReturnType<typeof vi.fn> } | null): string[] {
  return client?.request.mock.calls.map(([method]) => method) ?? [];
}

function requestCallOrder(client: { request: ReturnType<typeof vi.fn> } | null, method: string): number {
  const index = client?.request.mock.calls.findIndex(([calledMethod]) => calledMethod === method) ?? -1;
  return index === -1 ? Number.POSITIVE_INFINITY : (client?.request.mock.invocationCallOrder[index] ?? Number.POSITIVE_INFINITY);
}

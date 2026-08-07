import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { Thread } from "../../../../src/domain/threads/model";
import { createThreadMutationAdapter } from "../../../../src/features/threads/app-server/workflow-adapters";
import type { ArchiveExportDestination } from "../../../../src/features/threads/workflows/archive-export";
import type { ThreadFact } from "../../../../src/features/threads/workflows/thread-facts";
import {
  type ArchiveThreadResult,
  createThreadMutationCommands,
  type ThreadMutationCommandsHost,
} from "../../../../src/features/threads/workflows/thread-mutation-commands";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { deferred } from "../../../support/async";
import { legacyTurnContextManifestText } from "../../../support/legacy-turn-context-manifest";

describe("ThreadMutationCommands", () => {
  it("renames a thread and notifies shared surfaces after success", async () => {
    const { mutations, client, catalog } = operationsFixture();

    await expect(mutations.renameThread("thread", "  Saved   title  ")).resolves.toBe(true);

    expect(client?.request).toHaveBeenCalledWith("thread/name/set", { threadId: "thread", name: "Saved title" });
    expect(catalog.apply).toHaveBeenCalledWith({ type: "thread-renamed", threadId: "thread", name: "Saved title" });
  });

  it("can skip rename publication when the caller invalidates the save", async () => {
    const { mutations, catalog } = operationsFixture();

    await mutations.renameThread("thread", "Generated title", { shouldPublish: () => false });

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("can skip a rename before contacting the app server", async () => {
    const { mutations, client, catalog } = operationsFixture();

    await expect(mutations.renameThread("thread", "Title", { shouldStart: () => false })).resolves.toBe(false);
    await expect(mutations.renameThread("thread", "   ")).resolves.toBe(false);

    expect(client?.request).not.toHaveBeenCalled();
    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("pins a thread and notifies shared surfaces after success", async () => {
    const { mutations, client, catalog } = operationsFixture();

    await mutations.setThreadPinned("thread", true);

    expect(client?.request).toHaveBeenCalledWith("threadSection/list", { cursor: null, limit: 100 });
    expect(client?.request).toHaveBeenCalledWith("thread/section/move", { threadId: "thread", sectionId: "pinned" });
    expect(catalog.apply).toHaveBeenCalledWith({ type: "thread-pinned", threadId: "thread", isPinned: true });
  });

  it("unpins without listing sections and publishes only after the move succeeds", async () => {
    const { mutations, client, catalog } = operationsFixture();

    await mutations.setThreadPinned("thread", false);

    expect(client?.request).toHaveBeenCalledOnce();
    expect(client?.request).toHaveBeenCalledWith("thread/section/move", { threadId: "thread", sectionId: null });
    expect(catalog.apply).toHaveBeenCalledWith({ type: "thread-pinned", threadId: "thread", isPinned: false });
  });

  it("does not publish a pin when the built-in section is unavailable", async () => {
    const client = clientMock();
    client.request.mockResolvedValueOnce({ data: [], nextCursor: null });
    const { mutations, catalog } = operationsFixture({ client });

    await expect(mutations.setThreadPinned("thread", true)).rejects.toThrow("built-in Pinned thread section");

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("serializes successive names for the same thread", async () => {
    const generatedSave = deferred<object>();
    const client = clientMock();
    client.request.mockImplementationOnce(async (method: string) => {
      if (method !== "thread/name/set") throw new Error(`Unexpected app-server request: ${method}`);
      return generatedSave.promise;
    });
    const { mutations } = operationsFixture({ client });

    const generated = mutations.renameThread("thread", "Generated title");
    await Promise.resolve();
    const firstManual = mutations.renameThread("thread", "First manual title");
    const latestManual = mutations.renameThread("thread", "Latest manual title");
    await Promise.resolve();

    expect(client.request).toHaveBeenCalledTimes(1);
    generatedSave.resolve({});
    await Promise.all([generated, firstManual, latestManual]);

    expect(client.request).toHaveBeenNthCalledWith(1, "thread/name/set", { threadId: "thread", name: "Generated title" });
    expect(client.request).toHaveBeenNthCalledWith(2, "thread/name/set", { threadId: "thread", name: "First manual title" });
    expect(client.request).toHaveBeenNthCalledWith(3, "thread/name/set", { threadId: "thread", name: "Latest manual title" });
  });

  it("archives a thread, reports exported markdown, and notifies shared surfaces", async () => {
    const { mutations, catalog, client, archiveDestination } = operationsFixture();

    await expect(mutations.archiveThread("thread", { saveMarkdown: true })).resolves.toEqual({
      kind: "archived",
      exportedPath: "Archive/Archived Thread abcdef12.md",
    });

    expect(client?.request).toHaveBeenCalledWith("thread/read", { threadId: "thread", includeTurns: true });
    expect(archiveDestination.createMarkdownFile).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client?.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
    expect(callOrder(archiveDestination.createMarkdownFile)).toBeLessThan(requestCallOrder(client, "thread/archive"));
    expect(catalog.apply).toHaveBeenCalledWith({
      type: "thread-archived",
      threadId: "thread",
    });
  });

  it("rejects a second archive for the same thread while the first is pending", async () => {
    const archive = deferred<object>();
    const client = clientMock();
    client.request.mockImplementation(async (method: string) => {
      if (method === "thread/archive") return archive.promise;
      throw new Error(`Unexpected app-server request: ${method}`);
    });
    const { mutations, catalog } = operationsFixture({ client });

    const first = mutations.archiveThread("thread");
    await Promise.resolve();
    await expect(mutations.archiveThread("thread")).rejects.toThrow("An operation is already in progress.");
    expect(client.request).toHaveBeenCalledOnce();

    archive.resolve({});
    await first;
    expect(catalog.apply).toHaveBeenCalledOnce();
  });

  it("blocks archive before contacting the app server when the thread is active", async () => {
    const { mutations, client, catalog } = operationsFixture({ threadIsBusy: () => true });

    await expect(mutations.archiveThread("thread")).resolves.toEqual({ kind: "blocked", reason: "thread-busy" });

    expect(client?.request).not.toHaveBeenCalled();
    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("rechecks panel activity inside the coordinated archive operation", async () => {
    let busy = false;
    const { mutations, client, catalog } = operationsFixture({ threadIsBusy: () => busy });

    const archive = mutations.archiveThread("thread");
    busy = true;

    await expect(archive).resolves.toEqual({ kind: "blocked", reason: "thread-busy" });
    expect(client?.request).not.toHaveBeenCalled();
    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("announces archive target adoption immediately before publishing the archive fact", async () => {
    const { mutations, catalog } = operationsFixture();
    const beforePublish = vi.fn();

    await mutations.archiveThread("thread", { saveMarkdown: false, beforePublish });

    expect(beforePublish).toHaveBeenCalledOnce();
    expect(callOrder(beforePublish)).toBeLessThan(callOrder(catalog.apply));
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
          threadId: "thread-reference",
          includedTurns: 1,
          turnLimit: 20,
          omittedTurns: 0,
          truncated: false,
        },
      ],
    });
    client.request.mockImplementation((method: string, params: { threadId?: string; name?: string }) => {
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
    const { mutations, archiveDestination } = operationsFixture({ client, referenceThreads: [reference] });

    await mutations.archiveThread("thread", { saveMarkdown: true });

    expect(archiveDestination.createMarkdownFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("> Referenced: Readable reference title"),
    );
  });

  it("archives without reading transcript history when markdown export is disabled", async () => {
    const { mutations, client, archiveDestinationFactory, archiveExportSettings } = operationsFixture();

    await expect(mutations.archiveThread("thread")).resolves.toEqual({
      kind: "archived",
      exportedPath: null,
    } satisfies ArchiveThreadResult);

    expect(requestMethods(client)).not.toContain("thread/read");
    expect(archiveExportSettings).not.toHaveBeenCalled();
    expect(archiveDestinationFactory).not.toHaveBeenCalled();
    expect(client?.request).toHaveBeenCalledWith("thread/archive", { threadId: "thread" });
  });

  it("does not notify surfaces when an operation has no current client", async () => {
    const { mutations, catalog } = operationsFixture({ client: null });

    await expect(mutations.renameThread("thread", "Title")).rejects.toThrow("No current client.");
    await expect(mutations.archiveThread("thread")).rejects.toThrow("No current client.");

    expect(catalog.apply).not.toHaveBeenCalled();
  });

  it("restores and deletes archived threads through the shared lifecycle owner", async () => {
    const { mutations, client, catalog } = operationsFixture();

    await expect(mutations.restoreThread("thread")).resolves.toMatchObject({ id: "abcdef12-9999", archived: false });
    await expect(mutations.deleteThread("thread")).resolves.toBeUndefined();

    expect(client?.request).toHaveBeenCalledWith("thread/unarchive", { threadId: "thread" });
    expect(client?.request).toHaveBeenCalledWith("thread/delete", { threadId: "thread" }, {});
    expect(catalog.apply).toHaveBeenCalledWith(expect.objectContaining({ type: "thread-restored" }));
    expect(catalog.apply).toHaveBeenCalledWith({ type: "thread-deleted", threadId: "thread" });
  });
});

function operationsFixture(
  options: { client?: MockClient | null; referenceThreads?: readonly Thread[]; threadIsBusy?: (threadId: string) => boolean } = {},
) {
  const client = options.client === undefined ? clientMock() : options.client;
  const archiveDestination = archiveDestinationMock();
  const archiveDestinationFactory = vi.fn(() => archiveDestination);
  const archiveExportSettings = vi.fn(() => ({
    archiveExportFolderTemplate: "Archive",
    archiveExportFilenameTemplate: "{{title}} {{shortId}}",
    archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
  }));
  const apply = vi.fn();
  const catalog = {
    apply,
    applyBatch: vi.fn((facts: readonly ThreadFact[]) => {
      for (const fact of facts) apply(fact);
    }),
  };
  const host: ThreadMutationCommandsHost = {
    port: createThreadMutationAdapter({
      withClient: async (operation) => {
        if (!client) throw new Error("No current client.");
        return operation(client as unknown as AppServerClient);
      },
    }),
    archiveExport: {
      settings: archiveExportSettings,
      enabled: () => false,
      vaultPath: "/vault",
      vaultConfigDir: "vault-config",
    },
    archiveDestination: archiveDestinationFactory,
    facts: catalog,
    referenceThreads: () => options.referenceThreads ?? [],
    threadIsBusy: options.threadIsBusy ?? (() => false),
  };
  return {
    mutations: createThreadMutationCommands(host),
    client,
    archiveDestination,
    archiveDestinationFactory,
    archiveExportSettings,
    catalog,
  };
}

type MockClient = ReturnType<typeof clientMock>;

function clientMock() {
  return {
    request: vi.fn((method: string, params: { threadId?: string; name?: string }) => {
      if (method === "thread/name/set") return Promise.resolve({ threadId: params.threadId, name: params.name });
      if (method === "threadSection/list") return Promise.resolve({ data: [{ id: "pinned", name: "Pinned" }], nextCursor: null });
      if (method === "thread/section/move") return Promise.resolve({});
      if (method === "thread/read") return Promise.resolve({ thread: archivedThread() });
      if (method === "thread/archive") return Promise.resolve({});
      if (method === "thread/unarchive") return Promise.resolve({ thread: archivedThread() });
      if (method === "thread/delete") return Promise.resolve({});
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

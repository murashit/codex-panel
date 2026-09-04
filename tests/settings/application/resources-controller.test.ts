import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelMetadataFromCatalogModels } from "../../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../../src/app-server/protocol/thread";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { Thread } from "../../../src/domain/threads/model";
import { SettingsResourcesController } from "../../../src/settings/application/resources-controller";
import type { SettingsTabHost } from "../../../src/settings/host/contracts";
import type { ObservedResult } from "../../../src/shared/async/observed-result";
import { deferred } from "../../support/async";
import {
  appServerThread,
  flushPromises,
  hook,
  model,
  panelThread,
  setSettingsContextClientMock,
  settingsClient,
  settingsRequestClient,
  settingsTabHost,
  useContextClients,
} from "../test-support";

type SettingsResourcesSnapshot = ReturnType<SettingsResourcesController["snapshot"]>;

const { contextConnectionClientMock } = vi.hoisted(() => ({
  contextConnectionClientMock: vi.fn(),
}));

vi.mock("../../../src/app-server/connection/context-connection", () => ({
  AppServerContextConnection: class {
    constructor(
      private readonly codexPath: string,
      private readonly cwd: string,
    ) {}

    withClient(operation: unknown) {
      return contextConnectionClientMock(this.codexPath, this.cwd, operation);
    }

    dispose() {}
  },
}));

setSettingsContextClientMock(contextConnectionClientMock);

const noop = (): void => undefined;

function settingsResourcesController(
  host: SettingsTabHost,
  callbacks: { display(): void; notify(message: string): void },
): SettingsResourcesController {
  return new SettingsResourcesController(host.resources, callbacks);
}

describe("SettingsResourcesController", () => {
  beforeEach(() => {
    contextConnectionClientMock.mockReset();
  });

  it("publishes archived thread catalog updates", () => {
    let emitArchived = (_threads: readonly Thread[]): void => {
      throw new Error("Expected archived thread observer");
    };
    const display = vi.fn();
    const controller = settingsResourcesController(
      settingsTabHost({
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
      }),
      { display, notify: noop },
    );

    controller.activate();
    emitArchived([panelThread({ id: "thread-archived", preview: "Archived elsewhere", archived: true })]);

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Archived elsewhere"]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("idle");
    expect(display).toHaveBeenCalledOnce();
  });

  it("deduplicates a loading section without blocking completed section refreshes", async () => {
    const firstModels = deferred<ModelMetadata[]>();
    const firstClient = settingsClient();
    useContextClients(firstClient);
    const refreshModels = vi.fn(() => firstModels.promise);
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New", archived: true })]);
    const controller = settingsResourcesController(settingsTabHost({ refreshModels, refreshArchived }), {
      display: noop,
      notify: noop,
    });

    const firstRefresh = controller.refresh();
    expect(controller.canRefresh()).toBe(false);
    await flushPromises();
    expect(controller.canRefresh()).toBe(true);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old"]);
    await controller.refresh();

    expect(refreshModels).toHaveBeenCalledOnce();
    expect(refreshArchived).toHaveBeenCalledTimes(2);
    expect(contextConnectionClientMock).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().modelsLifecycle.kind).toBe("loading");
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);

    firstModels.resolve(modelMetadataFromCatalogModels([model("gpt-old")]));
    await firstRefresh;

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-old"]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);
  });

  it("does not display dynamic refresh results after disposal", async () => {
    const models = deferred<ModelMetadata[]>();
    const display = vi.fn();
    const controller = settingsResourcesController(
      settingsTabHost({
        refreshModels: vi.fn(() => models.promise),
        refreshArchived: vi.fn().mockResolvedValue([]),
      }),
      { display, notify: noop },
    );

    const refresh = controller.refresh();
    await flushPromises();
    display.mockClear();
    controller.dispose();
    models.resolve([]);
    await refresh;

    expect(display).not.toHaveBeenCalled();
  });

  it("reloads hooks after the settings view is hidden and shown again", async () => {
    const firstHooks = deferred<unknown>();
    const firstClient = settingsClient();
    firstClient.requestHandlers["hooks/list"] = vi.fn(() => firstHooks.promise);
    const secondClient = settingsClient({ hooks: [hook({ key: "hook-after-reopen" })] });
    useContextClients(firstClient, secondClient);
    const controller = settingsResourcesController(settingsTabHost(), { display: noop, notify: noop });

    controller.activate();
    controller.maybeAutoLoad();
    await flushPromises();
    controller.dispose();
    firstHooks.resolve({ data: [{ cwd: "/vault", hooks: [], warnings: [], errors: [] }] });
    await flushPromises();

    controller.activate();
    controller.maybeAutoLoad();
    await flushPromises();

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-after-reopen" })]);
    expect(firstClient.requestHandlers["hooks/list"]).toHaveBeenCalledOnce();
    expect(secondClient.requestHandlers["hooks/list"]).toHaveBeenCalledOnce();
  });

  it("settles a pending hook mutation after the settings view is hidden and shown again", async () => {
    const write = deferred<unknown>();
    const client = settingsClient({ hooks: [hook({ key: "hook-after-write", trustStatus: "trusted" })] });
    client.requestHandlers["config/batchWrite"] = vi.fn(() => write.promise);
    useContextClients(client);
    const controller = settingsResourcesController(settingsTabHost(), { display: noop, notify: noop });

    controller.activate();
    const mutation = controller.trustHook(hook({ key: "hook-after-write", trustStatus: "untrusted" }));
    await flushPromises();
    controller.dispose();
    controller.activate();
    controller.maybeAutoLoad();

    expect(contextConnectionClientMock).toHaveBeenCalledOnce();

    write.resolve({});
    await mutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([
      expect.objectContaining({ key: "hook-after-write", trustStatus: "trusted" }),
    ]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
  });

  it("reloads authoritative hooks on the same client after a mutation", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-trusted", currentHash: "trusted-hash", trustStatus: "trusted" })],
    });
    useContextClients(client);
    const controller = settingsResourcesController(settingsTabHost(), { display: noop, notify: noop });

    await controller.trustHook(hook({ key: "hook-trusted", currentHash: "untrusted-hash", trustStatus: "untrusted" }));

    expect(client.request.mock.calls.map(([method]) => method)).toEqual(["config/batchWrite", "hooks/list"]);
    expect(contextConnectionClientMock).toHaveBeenCalledOnce();
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([
      expect.objectContaining({ key: "hook-trusted", currentHash: "trusted-hash" }),
    ]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
  });

  it("does not publish an old-context hook mutation over a replacement-context refresh", async () => {
    const oldWrite = deferred<unknown>();
    const oldClient = settingsClient({ hooks: [hook({ key: "hook-old-context" })] });
    oldClient.requestHandlers["config/batchWrite"] = vi.fn(() => oldWrite.promise);
    const newClient = settingsClient({ hooks: [hook({ key: "hook-new-context" })] });
    useContextClients(oldClient, newClient);
    const host = settingsTabHost();
    const notify = vi.fn();
    const controller = settingsResourcesController(host, { display: noop, notify });
    controller.activate();

    const oldMutation = controller.trustHook(hook({ key: "hook-old-context", trustStatus: "untrusted" }));
    await flushPromises();
    const publication = await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    controller.replaceResources(publication.replacementResources as NonNullable<typeof publication.replacementResources>);
    await controller.refresh();

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);

    oldWrite.resolve({});
    await oldMutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refreshes models and hooks while an archived thread operation is loading", async () => {
    const staleRestore = deferred<{ thread: ThreadRecord }>();
    const applyThreadFact = vi.fn();
    const initialClient = settingsClient({ hooks: [hook({ key: "hook-old" })] });
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => staleRestore.promise),
    });
    const newerClient = settingsClient({ hooks: [hook({ key: "hook-new" })] });
    useContextClients(initialClient, restoreClient, newerClient);
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old archived", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New archived", archived: true })]);
    const refreshModels = vi
      .fn()
      .mockResolvedValueOnce(modelMetadataFromCatalogModels([model("gpt-old")]))
      .mockResolvedValueOnce(modelMetadataFromCatalogModels([model("gpt-new")]));
    const controller = settingsResourcesController(settingsTabHost({ applyThreadFact, refreshArchived, refreshModels }), {
      display: noop,
      notify: noop,
    });

    await controller.refresh();
    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    expect(controller.canRefresh()).toBe(true);
    await controller.refresh();

    expect(refreshArchived).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledTimes(2);
    expect(contextConnectionClientMock).toHaveBeenCalledTimes(3);
    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new" })]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old archived"]);

    staleRestore.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await restore;

    expect(applyThreadFact).not.toHaveBeenCalled();
  });

  it("rejects a conflicting archived mutation while one is pending", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreRequest = vi.fn(() => restoreResult.promise);
    const deleteRequest = vi.fn().mockResolvedValue({});
    const restoreClient = settingsRequestClient({
      "thread/unarchive": restoreRequest,
    });
    const deleteClient = settingsRequestClient({
      "thread/delete": deleteRequest,
    });
    const applyThreadFact = vi.fn();
    useContextClients(restoreClient, deleteClient);
    const controller = settingsResourcesController(settingsTabHost({ applyThreadFact }), {
      display: noop,
      notify: noop,
    });

    const restore = controller.restoreArchivedThread("thread-old");
    const deletion = controller.deleteArchivedThread("thread-old");
    await flushPromises();

    expect(restoreRequest).toHaveBeenCalledOnce();
    expect(deleteRequest).not.toHaveBeenCalled();
    expect(contextConnectionClientMock).toHaveBeenCalledOnce();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await Promise.all([restore, deletion]);

    expect(deleteRequest).not.toHaveBeenCalled();
    expect(applyThreadFact).not.toHaveBeenCalled();
    expect(contextConnectionClientMock).toHaveBeenCalledOnce();
  });

  it("lets a completed archived mutation settle after the settings view is disposed", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => restoreResult.promise),
    });
    const applyThreadFact = vi.fn();
    const display = vi.fn();
    useContextClients(restoreClient);
    const controller = settingsResourcesController(settingsTabHost({ applyThreadFact }), {
      display,
      notify: noop,
    });

    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    controller.dispose();
    display.mockClear();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored after close" }) });
    await restore;

    expect(applyThreadFact).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });

  it("does not publish archived mutation facts after its app-server context is replaced", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => restoreResult.promise),
    });
    const applyThreadFact = vi.fn();
    useContextClients(restoreClient);
    const host = settingsTabHost({ applyThreadFact });
    const controller = settingsResourcesController(host, { display: noop, notify: noop });

    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored after replacement" }) });
    await restore;

    expect(applyThreadFact).not.toHaveBeenCalled();
  });

  it("lets replacement and previous context mutations settle independently", async () => {
    const oldRestore = deferred<{ thread: ThreadRecord }>();
    const oldClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => oldRestore.promise),
    });
    const newClient = settingsRequestClient({
      "thread/unarchive": vi.fn().mockResolvedValue({
        thread: appServerThread({ id: "thread-shared", preview: "New context" }),
      }),
    });
    useContextClients(oldClient, newClient);
    const host = settingsTabHost();

    const staleMutation = host.resources.restoreArchivedThread("thread-shared");
    await flushPromises();
    const publication = await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    if (!publication.replacementResources) throw new Error("Expected replacement settings data.");
    const currentMutation = publication.replacementResources.restoreArchivedThread("thread-shared");

    await expect(currentMutation).resolves.toMatchObject({ id: "thread-shared", preview: "New context" });
    expect(newClient.requestHandlers["thread/unarchive"]).toHaveBeenCalledOnce();

    oldRestore.resolve({
      thread: appServerThread({ id: "thread-shared", preview: "Old context" }),
    });
    await expect(staleMutation).resolves.toMatchObject({ id: "thread-shared", preview: "Old context" });
  });

  it("displays restored archived thread state after recording the active catalog event", async () => {
    const snapshots: SettingsResourcesSnapshot[] = [];
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const initialClient = settingsClient();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(async () => {
        emitArchived([]);
        return { thread: appServerThread({ id: "thread-old", preview: "Restored old" }) };
      }),
    });
    useContextClients(initialClient, restoreClient);
    const controllerRef: { current: SettingsResourcesController | null } = { current: null };
    const controller = settingsResourcesController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: noop,
      },
    );
    controllerRef.current = controller;
    controller.activate();

    await controller.refresh();
    snapshots.length = 0;
    await controller.restoreArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("idle");
  });

  it("displays deleted archived thread state after recording the catalog event", async () => {
    const snapshots: SettingsResourcesSnapshot[] = [];
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const initialClient = settingsClient();
    const deleteClient = settingsRequestClient({
      "thread/delete": vi.fn(async () => {
        emitArchived([]);
        return {};
      }),
    });
    useContextClients(initialClient, deleteClient);
    const controllerRef: { current: SettingsResourcesController | null } = { current: null };
    const controller = settingsResourcesController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: noop,
      },
    );
    controllerRef.current = controller;
    controller.activate();

    await controller.refresh();
    snapshots.length = 0;
    await controller.deleteArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("idle");
  });
});

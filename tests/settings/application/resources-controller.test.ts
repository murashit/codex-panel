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
  settingsClient,
  settingsContextClientMock,
  settingsRequestClient,
  settingsTabHost,
  useContextClients,
} from "../test-support";

type SettingsResourcesSnapshot = ReturnType<SettingsResourcesController["snapshot"]>;

const noop = (): void => undefined;

function settingsResourcesController(
  host: SettingsTabHost,
  callbacks: { display(): void; notify(message: string): void },
): SettingsResourcesController {
  return new SettingsResourcesController(host.resources, callbacks);
}

describe("SettingsResourcesController", () => {
  beforeEach(() => {
    settingsContextClientMock.mockReset();
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
    display.mockClear();
    const archivedThreads = [panelThread({ id: "thread-archived", preview: "Archived elsewhere", archived: true })];
    emitArchived(archivedThreads);

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Archived elsewhere"]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("idle");
    expect(display).toHaveBeenCalledOnce();
  });

  it("refreshes completed sections while another resource remains loading", async () => {
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
    controller.activate();

    const firstRefresh = controller.refresh();
    await flushPromises();
    expect(controller.canRefresh()).toBe(true);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old"]);
    const secondRefresh = controller.refresh();
    await flushPromises();

    expect(refreshArchived).toHaveBeenCalledTimes(2);
    expect(settingsContextClientMock).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().modelsLifecycle.kind).toBe("loading");
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);

    firstModels.resolve(modelMetadataFromCatalogModels([model("gpt-old")]));
    await Promise.all([firstRefresh, secondRefresh]);

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-old"]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);
  });

  it("does not display dynamic refresh results after disposal", async () => {
    useContextClients(settingsClient());
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

    expect(settingsContextClientMock).toHaveBeenCalledOnce();

    write.resolve({});
    await mutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([
      expect.objectContaining({ key: "hook-after-write", trustStatus: "trusted" }),
    ]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
  });

  it("retires a failed hook operation when the catalog refreshes successfully", async () => {
    const failedClient = settingsClient();
    failedClient.requestHandlers["config/batchWrite"] = vi.fn().mockRejectedValue(new Error("write failed"));
    const refreshedClient = settingsClient({ hooks: [hook({ key: "hook-refreshed" })] });
    useContextClients(failedClient, refreshedClient);
    const controller = settingsResourcesController(settingsTabHost(), { display: noop, notify: noop });
    controller.activate();

    await controller.trustHook(hook({ trustStatus: "untrusted" }));
    expect(controller.snapshot().hooksLifecycle.kind).toBe("failed");

    controller.dispose();
    controller.activate();
    await controller.refresh();

    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-refreshed" })]);
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
    controller.replaceResources(settingsTabHost().resources);
    await controller.refresh();

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);

    oldWrite.resolve({});
    await oldMutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refreshes models and hooks while an archived thread operation is loading", async () => {
    const staleRestore = deferred<{ thread: ThreadRecord }>();
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
    const controller = settingsResourcesController(settingsTabHost({ refreshArchived, refreshModels }), {
      display: noop,
      notify: noop,
    });
    controller.activate();

    await controller.refresh();
    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    expect(controller.canRefresh()).toBe(true);
    await controller.refresh();

    expect(refreshArchived).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledTimes(2);
    expect(settingsContextClientMock).toHaveBeenCalledTimes(3);
    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new" })]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old archived"]);

    staleRestore.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await restore;
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
    useContextClients(restoreClient, deleteClient);
    const controller = settingsResourcesController(settingsTabHost(), {
      display: noop,
      notify: noop,
    });

    const restore = controller.restoreArchivedThread("thread-old");
    const deletion = controller.deleteArchivedThread("thread-old");
    await flushPromises();

    expect(restoreRequest).toHaveBeenCalledOnce();
    expect(deleteRequest).not.toHaveBeenCalled();
    expect(settingsContextClientMock).toHaveBeenCalledOnce();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await Promise.all([restore, deletion]);

    expect(deleteRequest).not.toHaveBeenCalled();
    expect(settingsContextClientMock).toHaveBeenCalledOnce();
  });

  it("retires a failed archived operation when the catalog refreshes successfully", async () => {
    const failedRestoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn().mockRejectedValue(new Error("restore failed")),
    });
    useContextClients(failedRestoreClient, settingsClient());
    const controller = settingsResourcesController(
      settingsTabHost({
        refreshArchived: vi.fn().mockResolvedValue([panelThread({ id: "thread-refreshed", archived: true })]),
      }),
      { display: noop, notify: noop },
    );
    controller.activate();

    await controller.restoreArchivedThread("thread-old");
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("failed");

    controller.dispose();
    controller.activate();
    await controller.refresh();

    expect(controller.snapshot().archivedThreadsLifecycle).toEqual({ kind: "idle" });
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-refreshed"]);
  });

  it("lets a completed archived mutation settle after the settings view is disposed", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => restoreResult.promise),
    });
    const display = vi.fn();
    useContextClients(restoreClient);
    const controller = settingsResourcesController(settingsTabHost(), {
      display,
      notify: noop,
    });

    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    controller.dispose();
    display.mockClear();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored after close" }) });
    await restore;

    expect(display).not.toHaveBeenCalled();
  });

  it("does not publish an old-context archived mutation over replacement resources", async () => {
    const oldRestore = deferred<{ thread: ThreadRecord }>();
    const oldClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => oldRestore.promise),
    });
    useContextClients(oldClient, settingsClient());
    const host = settingsTabHost();
    const notify = vi.fn();
    const controller = settingsResourcesController(host, { display: noop, notify });
    controller.activate();

    const staleMutation = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    controller.replaceResources(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-new", preview: "New context", archived: true })],
      }).resources,
    );
    await controller.refresh();

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-new"]);

    oldRestore.reject(new Error("Old context failed"));
    await staleMutation;

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-new"]);
    expect(controller.snapshot().archivedThreadsLifecycle).toEqual({ kind: "idle" });
    expect(notify).not.toHaveBeenCalled();
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
});

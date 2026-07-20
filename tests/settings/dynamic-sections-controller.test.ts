import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelMetadataFromCatalogModels } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import type { ObservedResult } from "../../src/app-server/query/observed-result";
import { StaleAppServerResourceContextError } from "../../src/app-server/query/resource-store";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { SettingsDynamicSectionsController, type SettingsDynamicSectionsSnapshot } from "../../src/settings/dynamic-sections-controller";
import { deferred } from "../support/async";
import {
  appServerThread,
  flushPromises,
  hook,
  model,
  panelThread,
  setSettingsShortLivedClientMock,
  settingsClient,
  settingsRequestClient,
  settingsTabHost,
  useShortLivedClients,
} from "./test-support";

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
}));

setSettingsShortLivedClientMock(withShortLivedAppServerClientMock);

describe("SettingsDynamicSectionsController", () => {
  beforeEach(() => {
    withShortLivedAppServerClientMock.mockReset();
  });

  it("publishes archived thread catalog updates", () => {
    let emitArchived = (_threads: readonly Thread[]): void => {
      throw new Error("Expected archived thread observer");
    };
    const display = vi.fn();
    const controller = new SettingsDynamicSectionsController(
      settingsTabHost({
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
      }),
      { display, notify: vi.fn() },
    );

    controller.activate();
    emitArchived([panelThread({ id: "thread-archived", preview: "Archived elsewhere", archived: true })]);

    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["Archived elsewhere"]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("loaded");
    expect(display).toHaveBeenCalledOnce();
  });

  it("ignores stale dynamic sections refresh results after a newer refresh completes", async () => {
    const firstModels = deferred<ModelMetadata[]>();
    const firstClient = settingsClient();
    const secondClient = settingsClient({ models: [model("gpt-new")] });
    useShortLivedClients(firstClient, secondClient);
    const refreshModels = vi
      .fn()
      .mockReturnValueOnce(firstModels.promise)
      .mockResolvedValueOnce(modelMetadataFromCatalogModels([model("gpt-new")]));
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New", archived: true })]);
    const controller = new SettingsDynamicSectionsController(settingsTabHost({ refreshModels, refreshArchived }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

    const firstRefresh = controller.refreshDynamicSections();
    await flushPromises();
    await controller.refreshDynamicSections();

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New"]);

    firstModels.resolve(modelMetadataFromCatalogModels([model("gpt-old")]));
    await firstRefresh;

    expect(controller.snapshot().models.map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New"]);
  });

  it("does not display dynamic refresh results after disposal", async () => {
    const models = deferred<ModelMetadata[]>();
    const display = vi.fn();
    const controller = new SettingsDynamicSectionsController(
      settingsTabHost({
        refreshModels: vi.fn(() => models.promise),
        refreshArchived: vi.fn().mockResolvedValue([]),
      }),
      { display, notify: vi.fn() },
    );

    const refresh = controller.refreshDynamicSections();
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
    useShortLivedClients(firstClient, secondClient);
    const controller = new SettingsDynamicSectionsController(settingsTabHost(), { display: vi.fn(), notify: vi.fn() });

    controller.activate();
    controller.maybeAutoLoadDynamicSections();
    await flushPromises();
    controller.dispose();
    firstHooks.resolve({ data: [{ cwd: "/vault", hooks: [], warnings: [], errors: [] }] });
    await flushPromises();

    controller.activate();
    controller.maybeAutoLoadDynamicSections();
    await flushPromises();

    expect(controller.snapshot().hooks).toEqual([expect.objectContaining({ key: "hook-after-reopen" })]);
    expect(firstClient.requestHandlers["hooks/list"]).toHaveBeenCalledOnce();
    expect(secondClient.requestHandlers["hooks/list"]).toHaveBeenCalledOnce();
  });

  it("settles a pending hook mutation after the settings view is hidden and shown again", async () => {
    const write = deferred<unknown>();
    const client = settingsClient({ hooks: [hook({ key: "hook-after-write", trustStatus: "trusted" })] });
    client.requestHandlers["config/batchWrite"] = vi.fn(() => write.promise);
    useShortLivedClients(client);
    const controller = new SettingsDynamicSectionsController(settingsTabHost(), { display: vi.fn(), notify: vi.fn() });

    controller.activate();
    const mutation = controller.trustHook(hook({ key: "hook-after-write", trustStatus: "untrusted" }));
    await flushPromises();
    controller.dispose();
    controller.activate();
    controller.maybeAutoLoadDynamicSections();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledOnce();

    write.resolve({});
    await mutation;

    expect(controller.snapshot().hooks).toEqual([expect.objectContaining({ key: "hook-after-write", trustStatus: "trusted" })]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "loaded", status: "Trusted hook definition." });
  });

  it("reloads authoritative hooks on the same client after a mutation", async () => {
    const client = settingsClient({
      hooks: [hook({ key: "hook-trusted", currentHash: "trusted-hash", trustStatus: "trusted" })],
    });
    useShortLivedClients(client);
    const controller = new SettingsDynamicSectionsController(settingsTabHost(), { display: vi.fn(), notify: vi.fn() });

    await controller.trustHook(hook({ key: "hook-trusted", currentHash: "untrusted-hash", trustStatus: "untrusted" }));

    expect(client.request.mock.calls.map(([method]) => method)).toEqual(["config/batchWrite", "hooks/list"]);
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledOnce();
    expect(controller.snapshot().hooks).toEqual([expect.objectContaining({ key: "hook-trusted", currentHash: "trusted-hash" })]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "loaded", status: "Trusted hook definition." });
  });

  it("does not publish an old-context hook mutation over a replacement-context refresh", async () => {
    const oldWrite = deferred<unknown>();
    const oldClient = settingsClient({ hooks: [hook({ key: "hook-old-context" })] });
    oldClient.requestHandlers["config/batchWrite"] = vi.fn(() => oldWrite.promise);
    const newClient = settingsClient({ hooks: [hook({ key: "hook-new-context" })] });
    useShortLivedClients(oldClient, newClient);
    const host = settingsTabHost();
    const notify = vi.fn();
    const controller = new SettingsDynamicSectionsController(host, { display: vi.fn(), notify });
    controller.activate();

    const oldMutation = controller.trustHook(hook({ key: "hook-old-context", trustStatus: "untrusted" }));
    await flushPromises();
    const publication = await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    controller.replaceDynamicData(publication.replacementDynamicData as NonNullable<typeof publication.replacementDynamicData>);
    await controller.refreshDynamicSections();

    expect(controller.snapshot().hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);

    oldWrite.resolve({});
    await oldMutation;

    expect(controller.snapshot().hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("publishes stale-view archived restore facts without replacing a newer section result", async () => {
    const staleRestore = deferred<{ thread: ThreadRecord }>();
    const applyThreadCatalogEvent = vi.fn();
    const initialClient = settingsClient();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => staleRestore.promise),
    });
    const newerClient = settingsClient();
    useShortLivedClients(initialClient, restoreClient, newerClient);
    const refreshArchived = vi
      .fn()
      .mockResolvedValueOnce([panelThread({ id: "thread-old", preview: "Old archived", archived: true })])
      .mockResolvedValueOnce([panelThread({ id: "thread-new", preview: "New archived", archived: true })]);
    const controller = new SettingsDynamicSectionsController(settingsTabHost({ applyThreadCatalogEvent, refreshArchived }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

    await controller.refreshDynamicSections();
    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    await controller.refreshDynamicSections();

    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New archived"]);

    staleRestore.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await restore;

    expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
      type: "thread-restored",
      thread: expect.objectContaining({ id: "thread-old", preview: "Restored old", archived: false }),
    });
    expect(controller.snapshot().archivedThreads.map((thread) => thread.preview)).toEqual(["New archived"]);
  });

  it("serializes conflicting archived mutations and publishes their facts in order", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const deleteResult = deferred<unknown>();
    const restoreRequest = vi.fn(() => restoreResult.promise);
    const deleteRequest = vi.fn(() => deleteResult.promise);
    const restoreClient = settingsRequestClient({
      "thread/unarchive": restoreRequest,
    });
    const deleteClient = settingsRequestClient({
      "thread/delete": deleteRequest,
    });
    const applyThreadCatalogEvent = vi.fn();
    useShortLivedClients(restoreClient, deleteClient);
    const controller = new SettingsDynamicSectionsController(settingsTabHost({ applyThreadCatalogEvent }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

    const restore = controller.restoreArchivedThread("thread-old");
    const deletion = controller.deleteArchivedThread("thread-old");
    await flushPromises();

    expect(restoreRequest).toHaveBeenCalledOnce();
    expect(deleteRequest).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledOnce();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) });
    await flushPromises();

    expect(deleteRequest).toHaveBeenCalledOnce();
    expect(applyThreadCatalogEvent).toHaveBeenCalledTimes(1);

    deleteResult.resolve({});
    await Promise.all([restore, deletion]);

    expect(applyThreadCatalogEvent.mock.calls.map(([event]) => event.type)).toEqual(["thread-restored", "thread-deleted"]);
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
  });

  it("publishes a completed archived mutation after the settings view is disposed", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => restoreResult.promise),
    });
    const applyThreadCatalogEvent = vi.fn();
    const display = vi.fn();
    useShortLivedClients(restoreClient);
    const controller = new SettingsDynamicSectionsController(settingsTabHost({ applyThreadCatalogEvent }), {
      display,
      notify: vi.fn(),
    });

    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    controller.dispose();
    display.mockClear();

    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored after close" }) });
    await restore;

    expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
      type: "thread-restored",
      thread: expect.objectContaining({ id: "thread-old", preview: "Restored after close", archived: false }),
    });
    expect(display).not.toHaveBeenCalled();
  });

  it("does not publish archived mutation facts after its app-server context is replaced", async () => {
    const restoreResult = deferred<{ thread: ThreadRecord }>();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => restoreResult.promise),
    });
    const applyThreadCatalogEvent = vi.fn();
    useShortLivedClients(restoreClient);
    const host = settingsTabHost({ applyThreadCatalogEvent });
    const controller = new SettingsDynamicSectionsController(host, { display: vi.fn(), notify: vi.fn() });

    const restore = controller.restoreArchivedThread("thread-old");
    await flushPromises();
    await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    restoreResult.resolve({ thread: appServerThread({ id: "thread-old", preview: "Restored after replacement" }) });
    await restore;

    expect(applyThreadCatalogEvent).not.toHaveBeenCalled();
  });

  it("starts a replacement-context archived mutation while old work is still pending", async () => {
    const oldRestore = deferred<{ thread: ThreadRecord }>();
    const oldClient = settingsRequestClient({
      "thread/unarchive": vi.fn(() => oldRestore.promise),
    });
    const newClient = settingsRequestClient({
      "thread/unarchive": vi.fn().mockResolvedValue({
        thread: appServerThread({ id: "thread-shared", preview: "New context" }),
      }),
    });
    useShortLivedClients(oldClient, newClient);
    const host = settingsTabHost();

    const staleMutation = host.dynamicData.restoreArchivedThread("thread-shared");
    await flushPromises();
    const publication = await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    if (!publication.replacementDynamicData) throw new Error("Expected replacement settings data.");
    const currentMutation = publication.replacementDynamicData.restoreArchivedThread("thread-shared");

    await expect(currentMutation).resolves.toMatchObject({ id: "thread-shared", preview: "New context" });
    expect(newClient.requestHandlers["thread/unarchive"]).toHaveBeenCalledOnce();

    oldRestore.resolve({
      thread: appServerThread({ id: "thread-shared", preview: "Old context" }),
    });
    await expect(staleMutation).rejects.toBeInstanceOf(StaleAppServerResourceContextError);
  });

  it("records restored archived threads in the active catalog", async () => {
    const notify = vi.fn();
    const applyThreadCatalogEvent = vi.fn();
    const initialClient = settingsClient();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn().mockResolvedValue({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) }),
    });
    useShortLivedClients(initialClient, restoreClient);
    const controller = new SettingsDynamicSectionsController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        applyThreadCatalogEvent,
      }),
      { display: vi.fn(), notify },
    );

    await controller.refreshDynamicSections();
    await controller.restoreArchivedThread("thread-old");

    const snapshot = controller.snapshot();
    expect(snapshot.archivedThreads).toEqual([]);
    expect(snapshot.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
      type: "thread-restored",
      thread: expect.objectContaining({ id: "thread-old", preview: "Restored old", archived: false }),
    });
    expect(notify).not.toHaveBeenCalledWith("Could not restore archived Codex thread.");
  });

  it("displays restored archived thread state after recording the active catalog event", async () => {
    const snapshots: SettingsDynamicSectionsSnapshot[] = [];
    const initialClient = settingsClient();
    const restoreClient = settingsRequestClient({
      "thread/unarchive": vi.fn().mockResolvedValue({ thread: appServerThread({ id: "thread-old", preview: "Restored old" }) }),
    });
    useShortLivedClients(initialClient, restoreClient);
    const controllerRef: { current: SettingsDynamicSectionsController | null } = { current: null };
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const controller = new SettingsDynamicSectionsController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
        applyThreadCatalogEvent: () => {
          emitArchived([]);
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: vi.fn(),
      },
    );
    controllerRef.current = controller;

    await controller.refreshDynamicSections();
    snapshots.length = 0;
    await controller.restoreArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.status).toBe('Restored "Restored old".');
  });

  it("displays deleted archived thread status after recording the catalog event", async () => {
    const snapshots: SettingsDynamicSectionsSnapshot[] = [];
    const initialClient = settingsClient();
    const deleteClient = settingsRequestClient({
      "thread/delete": vi.fn().mockResolvedValue({}),
    });
    useShortLivedClients(initialClient, deleteClient);
    const controllerRef: { current: SettingsDynamicSectionsController | null } = { current: null };
    let emitArchived = (_threads: readonly Thread[]): void => undefined;
    const controller = new SettingsDynamicSectionsController(
      settingsTabHost({
        archivedThreads: [panelThread({ id: "thread-old", preview: "Old archived", archived: true })],
        observeArchived: (listener) => {
          emitArchived = (threads) => {
            listener({ value: threads, error: null, isFetching: false } satisfies ObservedResult<readonly Thread[]>);
          };
          return () => undefined;
        },
        applyThreadCatalogEvent: () => {
          emitArchived([]);
        },
      }),
      {
        display: () => {
          const snapshot = controllerRef.current?.snapshot();
          if (snapshot) snapshots.push(snapshot);
        },
        notify: vi.fn(),
      },
    );
    controllerRef.current = controller;

    await controller.refreshDynamicSections();
    snapshots.length = 0;
    await controller.deleteArchivedThread("thread-old");

    expect(snapshots.at(-1)?.archivedThreads).toEqual([]);
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshots.at(-1)?.archivedThreadsLifecycle.status).toBe('Deleted "Old archived".');
  });
});

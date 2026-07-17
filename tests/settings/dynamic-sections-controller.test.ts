import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { CatalogHookMetadata } from "../../src/app-server/protocol/catalog";
import { modelMetadataFromCatalogModels } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import type { ObservedResult } from "../../src/app-server/query/observed-result";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { StaleSettingsDynamicDataContextError } from "../../src/settings/dynamic-data";
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

  it("ignores stale hook reload results after a newer dynamic operation completes", async () => {
    const staleHooks = deferred<{
      data: { cwd: string; hooks: CatalogHookMetadata[]; warnings: string[]; errors: unknown[] }[];
    }>();
    const initialClient = settingsClient({
      hooks: [hook({ key: "hook-initial", command: "initial hook", currentHash: "initialhash" })],
    });
    const trustClient = settingsRequestClient({
      "config/batchWrite": vi.fn().mockResolvedValue({}),
    });
    const staleClient = settingsClient();
    staleClient.requestHandlers["hooks/list"]?.mockReturnValue(staleHooks.promise);
    const newerClient = settingsClient({
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    useShortLivedClients(initialClient, trustClient, staleClient, newerClient);
    const controller = new SettingsDynamicSectionsController(settingsTabHost(), { display: vi.fn(), notify: vi.fn() });

    await controller.refreshDynamicSections();
    const initialHook = controller.snapshot().hooks[0];
    if (!initialHook) throw new Error("Expected initial hook to load");
    const staleReload = controller.trustHook(initialHook);
    await flushPromises();
    await controller.refreshDynamicSections();

    expect(controller.snapshot().hooks.map((hook) => hook.currentHash)).toEqual(["newhash"]);

    staleHooks.resolve({
      data: [{ cwd: "/vault", hooks: [hook({ key: "hook-old", command: "old hook", currentHash: "oldhash" })], warnings: [], errors: [] }],
    });
    await staleReload;

    expect(controller.snapshot().hooks.map((item) => item.currentHash)).toEqual(["newhash"]);
  });

  it("keeps full refresh models and archived threads current when hook operations overlap", async () => {
    const models = deferred<readonly ModelMetadata[]>();
    const fullRefreshClient = settingsClient({
      hooks: [hook({ key: "hook-full", command: "full refresh hook", currentHash: "fullhash" })],
    });
    const trustClient = settingsRequestClient({
      "config/batchWrite": vi.fn().mockResolvedValue({}),
    });
    const hookReloadClient = settingsClient({
      hooks: [hook({ key: "hook-new", command: "new hook", currentHash: "newhash" })],
    });
    useShortLivedClients(fullRefreshClient, trustClient, hookReloadClient);
    const refreshModels = vi.fn().mockReturnValue(models.promise);
    const refreshArchived = vi.fn().mockResolvedValue([panelThread({ id: "thread-full", preview: "Full archived", archived: true })]);
    const controller = new SettingsDynamicSectionsController(settingsTabHost({ refreshModels, refreshArchived }), {
      display: vi.fn(),
      notify: vi.fn(),
    });

    const fullRefresh = controller.refreshDynamicSections();
    await flushPromises();
    await controller.trustHook(hook({ key: "hook-initial", command: "initial hook", currentHash: "initialhash" }));

    models.resolve(modelMetadataFromCatalogModels([model("gpt-refreshed")]));
    await fullRefresh;

    const snapshot = controller.snapshot();
    expect(snapshot.models.map((item) => item.model)).toEqual(["gpt-refreshed"]);
    expect(snapshot.modelsLifecycle.kind).toBe("loaded");
    expect(snapshot.archivedThreads.map((thread) => thread.preview)).toEqual(["Full archived"]);
    expect(snapshot.archivedThreadsLifecycle.kind).toBe("loaded");
    expect(snapshot.hooks.map((item) => item.currentHash)).toEqual(["newhash"]);
  });

  it("reconciles an earlier successful hook mutation when the latest queued mutation fails", async () => {
    const trustWrite = deferred<unknown>();
    const trustClient = settingsRequestClient({
      "config/batchWrite": vi.fn(() => trustWrite.promise),
    });
    const toggleClient = settingsRequestClient({
      "config/batchWrite": vi.fn().mockRejectedValue(new Error("toggle failed")),
    });
    const reconciledClient = settingsClient({
      hooks: [hook({ key: "hook-trusted", command: "trusted hook", currentHash: "trustedhash", trustStatus: "trusted" })],
    });
    useShortLivedClients(trustClient, toggleClient, reconciledClient);
    const notify = vi.fn();
    const controller = new SettingsDynamicSectionsController(settingsTabHost(), { display: vi.fn(), notify });
    const target = hook({ key: "hook-trusted", command: "trusted hook", currentHash: "trustedhash" });

    const trust = controller.trustHook(target);
    const toggle = controller.setHookEnabled(target, false);
    await flushPromises();
    trustWrite.resolve({});
    await Promise.all([trust, toggle]);

    expect(controller.snapshot().hooks.map((item) => item.currentHash)).toEqual(["trustedhash"]);
    expect(controller.snapshot().hooksLifecycle).toEqual({
      kind: "failed",
      status: "Could not update hook: toggle failed",
    });
    expect(notify).toHaveBeenCalledWith("Could not update Codex hook.");
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

  it("serializes hook mutations before starting the next short-lived client operation", async () => {
    const firstWrite = deferred<unknown>();
    const firstRequest = vi.fn(() => firstWrite.promise);
    const secondRequest = vi.fn().mockResolvedValue({});
    const firstClient = settingsRequestClient({
      "config/batchWrite": firstRequest,
    });
    const secondClient = settingsRequestClient({
      "config/batchWrite": secondRequest,
    });
    useShortLivedClients(firstClient, secondClient);
    const dynamicData = settingsTabHost().dynamicData;

    const trust = dynamicData.trustHook(hook({ key: "hook-first" }));
    const toggle = dynamicData.setHookEnabled(hook({ key: "hook-second" }), false);
    await flushPromises();

    expect(firstRequest).toHaveBeenCalledOnce();
    expect(secondRequest).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledOnce();

    firstWrite.resolve({});
    await trust;
    await toggle;

    expect(secondRequest).toHaveBeenCalledOnce();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
  });

  it("does not start a settings mutation after client acquisition crosses a context replacement", async () => {
    const acquisition = deferred<void>();
    const client = settingsRequestClient({
      "config/batchWrite": vi.fn().mockResolvedValue({}),
    });
    withShortLivedAppServerClientMock.mockImplementationOnce(
      async (_codexPath: string, _vaultPath: string, operation: (acquiredClient: AppServerClient) => Promise<unknown>) => {
        await acquisition.promise;
        return operation(client);
      },
    );
    const host = settingsTabHost();

    const trust = host.dynamicData.trustHook(hook({ key: "hook-old-context" }));
    await flushPromises();
    await host.publishSettings({ ...host.settings, codexPath: "/opt/codex-next" });
    acquisition.resolve(undefined);

    await expect(trust).rejects.toBeInstanceOf(StaleSettingsDynamicDataContextError);
    expect(client.request).not.toHaveBeenCalled();
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

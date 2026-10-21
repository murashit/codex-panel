import { describe, expect, it, vi } from "vitest";

import type { HookItem, ModelMetadata } from "../../../src/domain/runtime/catalog";
import type { Thread } from "../../../src/domain/threads/model";
import type { SettingsHookCatalog, SettingsResources } from "../../../src/settings/application/resources";
import { SettingsResourcesController } from "../../../src/settings/application/resources-controller";
import type { ObservedResult, ObservedResultListener } from "../../../src/shared/async/observed-result";
import { deferred } from "../../support/async";
import { modelMetadataFixture } from "../../support/model-metadata";
import { panelThreadFixture } from "../../support/panel-thread";

describe("SettingsResourcesController", () => {
  it("publishes archived thread catalog updates", () => {
    const { controller, archived, display } = controllerFixture();
    controller.activate();
    display.mockClear();

    archived.emit([panelThreadFixture({ id: "thread-archived", preview: "Archived elsewhere", archived: true })]);

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Archived elsewhere"]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("idle");
    expect(display).toHaveBeenCalledOnce();
  });

  it("refreshes completed sections while another resource remains loading", async () => {
    const { controller, resources, models, archived } = controllerFixture();
    const firstModels = deferred<readonly ModelMetadata[]>();
    resources.queries.refreshModels.mockReturnValue(firstModels.promise);
    controller.activate();

    const firstRefresh = controller.refresh();
    models.emit(null, { isFetching: true });
    archived.emit([panelThreadFixture({ id: "thread-old", preview: "Old", archived: true })]);
    expect(controller.canRefresh()).toBe(true);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old"]);
    const secondRefresh = controller.refresh();
    archived.emit([panelThreadFixture({ id: "thread-new", preview: "New", archived: true })]);

    expect(resources.threadCatalog.refreshArchivedThreads).toHaveBeenCalledTimes(2);
    expect(resources.queries.refreshHooks).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().modelsLifecycle.kind).toBe("loading");
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);

    const loadedModels = [modelMetadataFixture("gpt-old")];
    models.emit(loadedModels);
    firstModels.resolve(loadedModels);
    await Promise.all([firstRefresh, secondRefresh]);

    expect(controller.modelMetadata().map((item) => item.model)).toEqual(["gpt-old"]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["New"]);
  });

  it("does not display dynamic refresh results after disposal", async () => {
    const { controller, resources, models, display } = controllerFixture();
    const loading = deferred<readonly ModelMetadata[]>();
    resources.queries.refreshModels.mockReturnValue(loading.promise);
    models.emit([modelMetadataFixture("gpt-cached")]);
    controller.activate();
    expect(controller.modelMetadata().map((item) => item.model)).toEqual(["gpt-cached"]);
    expect(display).toHaveBeenCalled();
    const refresh = controller.refresh();

    controller.dispose();
    display.mockClear();
    models.emit([]);
    loading.resolve([]);
    await refresh;

    expect(models.unsubscribe).toHaveBeenCalledOnce();
    expect(display).not.toHaveBeenCalled();
  });

  it("reloads hooks after the settings view is hidden and shown again", async () => {
    const { controller, resources, hooks } = controllerFixture();
    const firstHooks = deferred<void>();
    resources.queries.refreshHooks.mockReturnValueOnce(firstHooks.promise);
    controller.activate();
    controller.maybeAutoLoad();
    controller.dispose();
    firstHooks.resolve(undefined);
    await firstHooks.promise;

    controller.activate();
    controller.maybeAutoLoad();
    hooks.emit(hookCatalog(hookFixture({ key: "hook-after-reopen" })));

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-after-reopen" })]);
    expect(resources.queries.refreshHooks).toHaveBeenCalledTimes(2);
  });

  it("settles a pending hook mutation after the settings view is hidden and shown again", async () => {
    const { controller, resources, hooks } = controllerFixture();
    const write = deferred<void>();
    resources.queries.trustHook.mockReturnValue(write.promise);
    controller.activate();
    const mutation = controller.trustHook(hookFixture({ trustStatus: "untrusted" }));
    controller.dispose();
    controller.activate();
    controller.maybeAutoLoad();

    expect(resources.queries.refreshHooks).not.toHaveBeenCalled();
    hooks.emit(hookCatalog(hookFixture({ key: "hook-after-write" })));
    write.resolve(undefined);
    await mutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-after-write" })]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
  });

  it.each([true, false])("locks hook controls until the enabled=%s operation settles", async (enabled) => {
    const { controller, resources, hooks, display } = controllerFixture();
    const write = deferred<void>();
    resources.queries.setHookEnabled.mockReturnValue(write.promise);
    controller.activate();
    const hook = hookFixture({ enabled: !enabled });

    const mutation = controller.setHookEnabled(hook, enabled);
    expect(resources.queries.setHookEnabled).toHaveBeenCalledExactlyOnceWith(hook, enabled);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "loading" });
    await controller.setHookEnabled(hook, !enabled);
    expect(resources.queries.setHookEnabled).toHaveBeenCalledOnce();
    display.mockClear();

    hooks.emit(hookCatalog(hookFixture({ enabled })));
    write.resolve(undefined);
    await mutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-key", enabled })]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
    expect(display).toHaveBeenCalled();
  });

  it("keeps hook operation failures out of catalog state", async () => {
    const { controller, resources, hooks, notify } = controllerFixture();
    resources.queries.trustHook.mockRejectedValue(new Error("write failed"));
    controller.activate();

    await controller.trustHook(hookFixture({ trustStatus: "untrusted" }));
    expect(controller.snapshot().hooksLifecycle.kind).toBe("idle");
    expect(notify).toHaveBeenCalledExactlyOnceWith("Could not trust hook: write failed");

    controller.dispose();
    controller.activate();
    await controller.refresh();
    hooks.emit(hookCatalog(hookFixture({ key: "hook-refreshed" })));

    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-refreshed" })]);
  });

  it("does not publish an old-context hook mutation over replacement resources", async () => {
    const { controller, resources, hooks, notify } = controllerFixture();
    const oldWrite = deferred<void>();
    resources.queries.trustHook.mockReturnValue(oldWrite.promise);
    controller.activate();
    const oldMutation = controller.trustHook(hookFixture({ trustStatus: "untrusted" }));
    const replacement = resourceFixture();
    controller.replaceResources(replacement.resources);
    await controller.refresh();
    replacement.hooks.emit(hookCatalog(hookFixture({ key: "hook-new-context" })));
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);

    hooks.emit(hookCatalog(hookFixture({ key: "hook-old-context" })));
    oldWrite.resolve(undefined);
    await oldMutation;

    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new-context" })]);
    expect(controller.snapshot().hooksLifecycle).toEqual({ kind: "idle" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("refreshes models and hooks while an archived thread operation is loading", async () => {
    const { controller, resources, models, hooks, archived } = controllerFixture();
    const restoreResult = deferred<Thread>();
    resources.threadMutations.restoreThread.mockReturnValue(restoreResult.promise);
    controller.activate();
    await controller.refresh();
    archived.emit([panelThreadFixture({ id: "thread-old", preview: "Old archived", archived: true })]);

    const restore = controller.restoreArchivedThread("thread-old");
    expect(controller.canRefresh()).toBe(true);
    await controller.refresh();
    models.emit([modelMetadataFixture("gpt-new")]);
    hooks.emit(hookCatalog(hookFixture({ key: "hook-new" })));

    expect(resources.threadCatalog.refreshArchivedThreads).toHaveBeenCalledOnce();
    expect(resources.queries.refreshModels).toHaveBeenCalledTimes(2);
    expect(resources.queries.refreshHooks).toHaveBeenCalledTimes(2);
    expect(controller.modelMetadata().map((item) => item.model)).toEqual(["gpt-new"]);
    expect(controller.snapshot().hookCatalog?.hooks).toEqual([expect.objectContaining({ key: "hook-new" })]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.preview)).toEqual(["Old archived"]);

    restoreResult.resolve(panelThreadFixture({ id: "thread-old" }));
    await restore;
  });

  it("rejects a conflicting archived mutation while one is pending, including after reopening", async () => {
    const { controller, resources } = controllerFixture();
    const restoreResult = deferred<Thread>();
    resources.threadMutations.restoreThread.mockReturnValue(restoreResult.promise);

    const restore = controller.restoreArchivedThread("thread-old");
    await controller.deleteArchivedThread("thread-old");
    controller.dispose();
    controller.activate();
    const deletion = controller.deleteArchivedThread("thread-old");

    expect(resources.threadMutations.restoreThread).toHaveBeenCalledExactlyOnceWith("thread-old");
    expect(resources.threadMutations.deleteThread).not.toHaveBeenCalled();
    restoreResult.resolve(panelThreadFixture({ id: "thread-old" }));
    await Promise.all([restore, deletion]);

    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("idle");
    expect(resources.threadMutations.deleteThread).not.toHaveBeenCalled();
  });

  it("keeps archived operation failures out of catalog state", async () => {
    const { controller, resources, archived, notify } = controllerFixture();
    resources.threadMutations.restoreThread.mockRejectedValue(new Error("restore failed"));
    controller.activate();

    await controller.restoreArchivedThread("thread-old");
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("idle");
    expect(notify).toHaveBeenCalledExactlyOnceWith("Could not restore archived thread: restore failed");

    controller.dispose();
    controller.activate();
    await controller.refresh();
    archived.emit([panelThreadFixture({ id: "thread-refreshed", archived: true })]);

    expect(controller.snapshot().archivedThreadsLifecycle).toEqual({ kind: "idle" });
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-refreshed"]);
  });

  it("lets a completed archived mutation settle after the settings view is disposed", async () => {
    const { controller, resources, display } = controllerFixture();
    const restoreResult = deferred<Thread>();
    resources.threadMutations.restoreThread.mockReturnValue(restoreResult.promise);
    const restore = controller.restoreArchivedThread("thread-old");
    controller.dispose();
    display.mockClear();

    restoreResult.resolve(panelThreadFixture({ id: "thread-old" }));
    await restore;

    expect(display).not.toHaveBeenCalled();
  });

  it("does not publish an old-context archived mutation over replacement resources", async () => {
    const { controller, resources, notify } = controllerFixture();
    const oldRestore = deferred<Thread>();
    resources.threadMutations.restoreThread.mockReturnValue(oldRestore.promise);
    controller.activate();
    const staleMutation = controller.restoreArchivedThread("thread-old");
    const replacement = resourceFixture();
    controller.replaceResources(replacement.resources);
    await controller.refresh();
    replacement.archived.emit([panelThreadFixture({ id: "thread-new", archived: true })]);
    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-new"]);

    oldRestore.reject(new Error("Old context failed"));
    await staleMutation;

    expect(controller.snapshot().archivedThreads?.map((thread) => thread.id)).toEqual(["thread-new"]);
    expect(controller.snapshot().archivedThreadsLifecycle).toEqual({ kind: "idle" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("displays the updated archived catalog when a restore finishes", async () => {
    const { controller, resources, archived, display } = controllerFixture();
    const restoreResult = deferred<Thread>();
    resources.threadMutations.restoreThread.mockReturnValue(restoreResult.promise);
    controller.activate();
    archived.emit([panelThreadFixture({ id: "thread-old", archived: true })]);
    const restore = controller.restoreArchivedThread("thread-old");
    archived.emit([]);
    expect(controller.snapshot().archivedThreads).toEqual([]);
    expect(controller.snapshot().archivedThreadsLifecycle.kind).toBe("loading");
    display.mockClear();
    const displayed: ReturnType<SettingsResourcesController["snapshot"]>[] = [];
    display.mockImplementation(() => displayed.push(controller.snapshot()));

    restoreResult.resolve(panelThreadFixture({ id: "thread-old" }));
    await restore;

    expect(display).toHaveBeenCalledOnce();
    expect(displayed).toMatchObject([{ archivedThreads: [], archivedThreadsLifecycle: { kind: "idle" } }]);
  });
});

function controllerFixture() {
  const fixture = resourceFixture();
  const display = vi.fn();
  const notify = vi.fn();
  return {
    ...fixture,
    display,
    notify,
    controller: new SettingsResourcesController(fixture.resources, { display, notify }),
  };
}

function resourceFixture() {
  const models = observedResults<readonly ModelMetadata[]>();
  const hooks = observedResults<SettingsHookCatalog>();
  const archived = observedResults<readonly Thread[]>();
  const resources = {
    queries: {
      observeModelsResult: models.observe,
      observeHooksResult: hooks.observe,
      fetchModels: vi.fn<SettingsResources["queries"]["fetchModels"]>().mockResolvedValue([]),
      refreshModels: vi.fn<SettingsResources["queries"]["refreshModels"]>().mockResolvedValue([]),
      refreshHooks: vi.fn<SettingsResources["queries"]["refreshHooks"]>().mockResolvedValue(undefined),
      trustHook: vi.fn<SettingsResources["queries"]["trustHook"]>().mockResolvedValue(undefined),
      setHookEnabled: vi.fn<SettingsResources["queries"]["setHookEnabled"]>().mockResolvedValue(undefined),
    },
    threadCatalog: {
      archivedThreadsSnapshot: () => archived.snapshot().value,
      observeArchivedThreadsResult: archived.observe,
      refreshArchivedThreads: vi.fn<SettingsResources["threadCatalog"]["refreshArchivedThreads"]>().mockResolvedValue([]),
    },
    threadMutations: {
      restoreThread: vi
        .fn<SettingsResources["threadMutations"]["restoreThread"]>()
        .mockResolvedValue(panelThreadFixture({ id: "restored" })),
      deleteThread: vi.fn<SettingsResources["threadMutations"]["deleteThread"]>().mockResolvedValue(undefined),
    },
  } satisfies SettingsResources;
  return { resources, models, hooks, archived };
}

function observedResults<T>() {
  let result: ObservedResult<T> = { value: null, error: null, isFetching: false };
  const listeners = new Set<ObservedResultListener<T>>();
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    snapshot: () => result,
    observe(listener: ObservedResultListener<T>) {
      listeners.add(listener);
      listener(result);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    emit(value: T | null, state: Partial<Omit<ObservedResult<T>, "value">> = {}) {
      result = { value, error: null, isFetching: false, ...state };
      for (const listener of listeners) listener(result);
    },
  };
}

function hookCatalog(...hooks: HookItem[]): SettingsHookCatalog {
  return { hooks, warnings: [], errors: [] };
}

function hookFixture(overrides: Partial<HookItem> = {}): HookItem {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    matcher: "apply_patch",
    handlerSummary: "node hook.js",
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "trusted",
    ...overrides,
  };
}

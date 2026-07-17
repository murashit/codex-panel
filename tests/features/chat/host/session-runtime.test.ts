// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaleAppServerResourceContextError } from "../../../../src/app-server/query/resource-store";
import type { Thread } from "../../../../src/domain/threads/model";
import { type ChatStateStore, createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createThreadGoalOperationCoordinator } from "../../../../src/features/chat/application/threads/goal-actions";
import { ChatResumeWorkTracker } from "../../../../src/features/chat/application/threads/resume-work";
import type { ChatPanelEnvironment } from "../../../../src/features/chat/host/contracts";
import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/session/deferred-work";
import { ChatPanelSessionRuntime } from "../../../../src/features/chat/host/session-runtime";
import { createChatThreadStreamScrollBinding } from "../../../../src/features/chat/panel/thread-stream-scroll-binding";
import { createThreadNameMutationCoordinator } from "../../../../src/features/threads/workflows/thread-name-mutation-coordinator";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { createKeyedOperationQueue } from "../../../../src/shared/runtime/keyed-operation-queue";
import { deferred, waitForAsyncWork } from "../../../support/async";
import { installObsidianDomShims } from "../../../support/dom";
import { chatPanelSettingsAccess } from "../support/settings";
import { composerModelFromChatState } from "../support/shell-selectors";

installObsidianDomShims();

describe("ChatPanelSessionRuntime actions", () => {
  let panelRoot: HTMLElement;

  beforeEach(() => {
    panelRoot = document.body.createDiv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("invalidates active resume, history, and restoration work through the runtime action", async () => {
    const { runtime, resumeWork, stateStore } = sessionRuntimeFixture();
    const resume = resumeWork.begin("thread-1");
    stateStore.dispatch({ type: "thread-stream/history-loading-set", loading: true });
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread-1", fallbackTitle: null });
    const restored = deferred<void>();
    const loadRestoredThread = vi.fn(() => restored.promise);
    const firstRestoration = runtime.thread.restoration.ensureLoaded(loadRestoredThread);

    runtime.actions.invalidateThreadWork();

    expect(resumeWork.isStale(resume)).toBe(true);
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    const secondRestoration = runtime.thread.restoration.ensureLoaded(loadRestoredThread);
    expect(loadRestoredThread).toHaveBeenCalledTimes(2);

    restored.resolve(undefined);
    await Promise.all([firstRestoration, secondRestoration]);
  });

  it("clears rename work before replacing the app-server context", () => {
    const { runtime, stateStore } = sessionRuntimeFixture();
    stateStore.dispatch({ type: "thread-list/applied", threads: [threadFixture({ id: "thread-1" })] });
    stateStore.dispatch({ type: "ui/rename-started", threadId: "thread-1", draft: "Draft" });

    runtime.actions.prepareAppServerContextChange();

    expect(stateStore.getState().ui.rename).toEqual({ kind: "idle" });
  });

  it("refreshes shared threads inside the runtime connection bundle", async () => {
    const thread = threadFixture({ id: "thread-1", preview: "From catalog" });
    const refresh = vi.fn().mockResolvedValue([thread]);
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: {
            refreshActive: refresh,
          },
        },
      },
    });

    await runtime.actions.refreshSharedThreads();

    expect(refresh).toHaveBeenCalledOnce();
    expect(stateStore.getState().threadList.listedThreads).toEqual([thread]);
  });

  it("treats stale shared thread refreshes as runtime-local no-ops", async () => {
    const refresh = vi.fn().mockRejectedValue(new StaleAppServerResourceContextError());
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: {
            refreshActive: refresh,
          },
        },
      },
    });

    await expect(runtime.actions.refreshSharedThreads()).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledOnce();
    expect(stateStore.getState().threadList.listedThreads).toEqual([]);
  });

  it("fans out active-thread identity changes after starting a new thread", async () => {
    const refreshLiveState = vi.fn();
    const refreshTabHeader = vi.fn();
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
        plugin: {
          workspace: {
            refreshThreadsViewLiveState: refreshLiveState,
          },
        },
        view: {
          refreshTabHeader,
        },
      },
    });
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: threadFixture({ id: "thread-1", preview: "Active" }),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    await runtime.actions.startNewThread();

    expect(refreshTabHeader).toHaveBeenCalledOnce();
    expect(refreshLiveState).toHaveBeenCalledOnce();
  });

  it("wires reconnect cleanup through the runtime toolbar action", async () => {
    const { runtime, stateStore } = sessionRuntimeFixture();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: threadFixture({ id: "thread-1", preview: "Active" }),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    vi.spyOn(runtime.connection.actions, "ensureConnected").mockResolvedValue(undefined);
    vi.spyOn(runtime.connection.manager, "isConnected").mockReturnValue(true);
    const resumeThread = vi.spyOn(runtime.thread.resume, "resumeThread").mockResolvedValue(true);

    runtime.shell.parts.toolbar.actions.status.connect();

    await waitForAsyncWork(() => {
      expect(resumeThread).toHaveBeenCalledWith("thread-1");
    });
    expect(stateStore.getState().connection.statusText).toBe("Reconnecting...");
  });

  it("disposes scheduled, subscribed, composer, scroll, and connection resources", async () => {
    vi.useFakeTimers();
    const unsubscribeThreads = vi.fn();
    const unsubscribeMetadata = vi.fn();
    const unsubscribeModels = vi.fn();
    const refreshLiveState = vi.fn();
    const { runtime, stateStore, deferredTasks, threadStreamScrollBinding } = sessionRuntimeFixture({
      environment: {
        plugin: {
          workspace: { refreshThreadsViewLiveState: refreshLiveState },
          threadCatalog: { observeActive: vi.fn(() => unsubscribeThreads) },
          appServerQueries: {
            observeAppServerMetadataResult: vi.fn(() => unsubscribeMetadata),
            observeModelsResult: vi.fn(() => unsubscribeModels),
          },
        },
      },
    });
    runtime.runtime.sharedState.subscribe();
    const diagnostics = vi.fn();
    const warmup = vi.fn();
    deferredTasks.scheduleDiagnostics(diagnostics);
    deferredTasks.scheduleAppServerWarmup(warmup);
    const dispatchScrollCommand = vi.fn();
    threadStreamScrollBinding.mountScrollPort({ dispatchScrollCommand });
    const composer = document.body.createEl("textarea");
    runtime.composer.controller.renderState(composerModelFromChatState(stateStore.getState()), { submit: vi.fn() }).onComposer(composer);
    composer.focus();
    expect(runtime.composer.controller.hasFocus()).toBe(true);
    const disconnect = vi.spyOn(runtime.connection.manager, "disconnect");
    const unmount = vi.fn();

    await runtime.dispose(unmount);

    expect([unsubscribeThreads, unsubscribeMetadata, unsubscribeModels].every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(
      true,
    );
    expect(runtime.composer.controller.hasFocus()).toBe(false);
    threadStreamScrollBinding.showLatest();
    expect(dispatchScrollCommand).not.toHaveBeenCalled();
    expect(unmount).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(refreshLiveState).toHaveBeenCalledOnce();

    await vi.runAllTimersAsync();
    expect(diagnostics).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
    expect(refreshLiveState).toHaveBeenCalledTimes(2);
  });

  function sessionRuntimeFixture(options: { environment?: PartialChatPanelEnvironment } = {}): {
    runtime: ChatPanelSessionRuntime;
    stateStore: ChatStateStore;
    resumeWork: ChatResumeWorkTracker;
    deferredTasks: ReturnType<typeof createChatViewDeferredTasks>;
    threadStreamScrollBinding: ReturnType<typeof createChatThreadStreamScrollBinding>;
  } {
    const stateStore = createChatStateStore();
    const resumeWork = new ChatResumeWorkTracker();
    const deferredTasks = createChatViewDeferredTasks(() => window);
    const threadStreamScrollBinding = createChatThreadStreamScrollBinding();
    const environment = chatPanelEnvironmentFixture(options.environment);
    const runtime = new ChatPanelSessionRuntime({
      environment,
      stateStore,
      deferredTasks,
      resumeWork,
      threadStreamScrollBinding,
      getClosing: () => false,
      viewWindow: () => window,
    });
    return { runtime, stateStore, resumeWork, deferredTasks, threadStreamScrollBinding };
  }

  interface PartialChatPanelEnvironment {
    obsidian?: Partial<ChatPanelEnvironment["obsidian"]>;
    plugin?: {
      workspace?: Partial<ChatPanelEnvironment["plugin"]["workspace"]>;
      threadCatalog?: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]>;
      appServerQueries?: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]>;
      settingsRef?: Partial<ChatPanelEnvironment["plugin"]["settingsRef"]>;
    };
    view?: Partial<ChatPanelEnvironment["view"]>;
  }

  function chatPanelEnvironmentFixture(overrides: PartialChatPanelEnvironment = {}): ChatPanelEnvironment {
    const threadCatalog = threadCatalogFixture(overrides.plugin?.threadCatalog);
    const appServerQueries = appServerQueriesFixture(overrides.plugin?.appServerQueries);
    const settingsRef = overrides.plugin?.settingsRef;
    const settingsSource: CodexPanelSettings = {
      ...DEFAULT_SETTINGS,
      codexPath: "codex",
      sendShortcut: "enter",
    };
    return {
      obsidian: {
        app: {
          workspace: {
            getActiveFile: vi.fn(() => null),
            getActiveViewOfType: vi.fn(() => null),
            getLastOpenFiles: vi.fn(() => []),
            on: vi.fn(() => ({})),
            openLinkText: vi.fn(),
          },
          vault: {
            on: vi.fn(() => ({})),
            offref: vi.fn(),
            getFiles: vi.fn(() => []),
            getMarkdownFiles: vi.fn(() => []),
            getAbstractFileByPath: vi.fn(() => null),
          },
          metadataCache: {
            on: vi.fn(() => ({})),
            offref: vi.fn(),
            getFirstLinkpathDest: vi.fn(() => null),
            fileToLinktext: vi.fn(() => ""),
            getFileCache: vi.fn(() => null),
          },
        } as never,
        owner: {} as never,
        viewId: "codex-test-view",
        registerEvent: vi.fn(),
        registerPointerDown: vi.fn(),
        archiveDestination: vi.fn(),
        requestWorkspaceLayoutSave: vi.fn(),
        isForeground: vi.fn(() => true),
        ...overrides.obsidian,
      },
      plugin: {
        settingsRef: {
          settings: settingsRef?.settings ?? chatPanelSettingsAccess(settingsSource),
          vaultPath: settingsRef?.vaultPath ?? "/vault",
        },
        workspace: {
          openThreadInNewView: vi.fn().mockResolvedValue(undefined),
          focusThreadInOpenView: vi.fn().mockResolvedValue(false),
          openTurnDiff: vi.fn().mockResolvedValue(undefined),
          refreshThreadsViewLiveState: vi.fn(),
          ...overrides.plugin?.workspace,
          openSideChat: overrides.plugin?.workspace?.openSideChat ?? vi.fn().mockResolvedValue(undefined),
        },
        appServerQueries,
        threadCatalog,
        threadNameMutations: createThreadNameMutationCoordinator(),
        threadGoalOperations: createThreadGoalOperationCoordinator(),
        runtimeSettingsCommitQueue: createKeyedOperationQueue(),
      },
      view: {
        panelRoot: () => panelRoot,
        viewWindow: () => window,
        refreshTabHeader: vi.fn(),
        ...overrides.view,
      },
    };
  }

  function threadCatalogFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]> = {},
  ): ChatPanelEnvironment["plugin"]["threadCatalog"] {
    return {
      loadActive: vi.fn().mockResolvedValue([]),
      refreshActive: vi.fn().mockResolvedValue([]),
      activeSnapshot: vi.fn(() => null),
      observeActive: vi.fn(() => () => undefined),
      apply: vi.fn(),
      applyConnectionEvent: vi.fn(),
      ...overrides,
    };
  }

  function appServerQueriesFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]> = {},
  ): ChatPanelEnvironment["plugin"]["appServerQueries"] {
    return {
      contextLease: vi.fn(() => ({ context: { codexPath: "codex", vaultPath: "/vault" }, generation: 1 })),
      appServerMetadataSnapshot: vi.fn(() => null),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      refreshSkills: vi.fn().mockResolvedValue(null),
      refreshRateLimits: vi.fn().mockResolvedValue(null),
      modelsSnapshot: vi.fn(() => null),
      fetchModels: vi.fn().mockResolvedValue([]),
      refreshModels: vi.fn().mockResolvedValue([]),
      observeAppServerMetadataResult: vi.fn(() => () => undefined),
      observeModelsResult: vi.fn(() => () => undefined),
      ...overrides,
    };
  }

  function threadFixture(overrides: Partial<Thread> = {}): Thread {
    return {
      id: "thread",
      preview: "",
      name: null,
      archived: false,
      provenance: { kind: "interactive" },
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }
});

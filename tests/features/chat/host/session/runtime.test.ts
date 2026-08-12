// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerDiagnostics } from "../../../../../src/domain/server/diagnostics";
import type { Thread } from "../../../../../src/domain/threads/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import type { ChatPanelEnvironment, CodexChatHost } from "../../../../../src/features/chat/host/contracts";
import { createChatViewDeferredTasks } from "../../../../../src/features/chat/host/session/deferred-work";
import { createChatPanelSessionRuntime } from "../../../../../src/features/chat/host/session/runtime";
import { createChatThreadStreamScrollBinding } from "../../../../../src/features/chat/host/thread-stream/scroll-binding";
import { createThreadGoalCoordinator } from "../../../../../src/features/threads/workflows/thread-goal-coordinator";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../../src/settings/preferences";
import { createKeyedOperationCoordinator } from "../../../../../src/shared/async/keyed-operation-coordinator";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { installObsidianDomShims } from "../../../../support/dom";
import { threadMutationCommandsMock } from "../../../../support/thread-mutations";
import { chatPanelSettingsAccess } from "../../support/settings";
import { composerModelFromChatState } from "../../support/shell-selectors";

installObsidianDomShims();

describe("chat panel session runtime", () => {
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

    runtime.commands.invalidateThreadWork();

    expect(resumeWork.isCurrent(resume)).toBe(false);
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    const secondRestoration = runtime.thread.restoration.ensureLoaded(loadRestoredThread);
    expect(loadRestoredThread).toHaveBeenCalledTimes(2);

    restored.resolve(undefined);
    await Promise.all([firstRestoration, secondRestoration]);
  });

  it("propagates shared thread refresh failures", async () => {
    const error = new Error("refresh failed");
    const refresh = vi.fn().mockRejectedValue(error);
    const { runtime } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: {
            refreshActiveThreads: refresh,
          },
        },
      },
    });

    await expect(runtime.commands.refreshSharedThreads()).rejects.toBe(error);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes persisted view identity after starting a new thread", async () => {
    const refreshTabHeader = vi.fn();
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
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
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    await runtime.commands.startNewThread();

    expect(refreshTabHeader).toHaveBeenCalledOnce();
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
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    vi.spyOn(runtime.connection.coordinator, "ensureConnected").mockResolvedValue(undefined);
    vi.spyOn(runtime.connection.manager, "isConnected").mockReturnValue(true);
    const resumeThread = vi.spyOn(runtime.thread.resume, "resumeThread").mockResolvedValue({
      hydrate: vi.fn().mockResolvedValue(true),
    });

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
    const { runtime, stateStore, deferredTasks, threadStreamScrollBinding } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: { observeActiveThreadsResult: vi.fn(() => unsubscribeThreads) },
          appServerQueries: {
            observeMetadataResource: vi.fn(() => unsubscribeMetadata),
          },
        },
      },
    });
    runtime.observers.threadCatalog.subscribe();
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
    const invalidateConnection = vi.spyOn(runtime.connection.coordinator, "invalidate");
    const invalidateThreadWork = vi.spyOn(runtime.commands, "invalidateThreadWork");
    const clearDeferredTasks = vi.spyOn(deferredTasks, "clearAll");
    const unsubscribeSharedState = vi.spyOn(runtime.observers.threadCatalog, "unsubscribe");
    const disposeComposer = vi.spyOn(runtime.composer.controller, "dispose");
    const disposeScrollBinding = vi.spyOn(threadStreamScrollBinding, "dispose");
    const disposeEphemeralThread = vi.spyOn(runtime.thread.ephemeral, "dispose");
    const unmount = vi.fn();

    await runtime.dispose(unmount);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(invalidateConnection).toHaveBeenCalledOnce();
    expect(invalidateThreadWork).toHaveBeenCalledOnce();
    expect(clearDeferredTasks).toHaveBeenCalledOnce();
    expect(unsubscribeSharedState).toHaveBeenCalledOnce();
    expect(disposeComposer).toHaveBeenCalledOnce();
    expect(disposeScrollBinding).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    expect(disposeEphemeralThread).toHaveBeenCalledOnce();
    expect(unsubscribeThreads).toHaveBeenCalled();
    expect(unsubscribeMetadata).toHaveBeenCalled();
    expect(runtime.composer.controller.hasFocus()).toBe(false);
    threadStreamScrollBinding.showLatest();
    expect(dispatchScrollCommand).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(diagnostics).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });

  function sessionRuntimeFixture(options: { environment?: PartialChatPanelEnvironment } = {}): {
    runtime: ReturnType<typeof createChatPanelSessionRuntime>;
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
    const runtime = createChatPanelSessionRuntime({
      environment,
      stateStore,
      deferredTasks,
      resumeWork,
      threadStreamScrollBinding,
      getClosing: () => false,
      activatePersistentThread: vi.fn().mockResolvedValue(undefined),
    });
    return { runtime, stateStore, resumeWork, deferredTasks, threadStreamScrollBinding };
  }

  interface PartialChatPanelEnvironment {
    obsidian?: Partial<ChatPanelEnvironment["obsidian"]>;
    plugin?: {
      workspace?: Partial<ChatPanelEnvironment["plugin"]["workspace"]>;
      threadCatalog?: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]>;
      threadFacts?: Partial<ChatPanelEnvironment["plugin"]["threadFacts"]>;
      appServerQueries?: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]>;
      settings?: ChatPanelEnvironment["plugin"]["settings"];
      appServerContext?: ChatPanelEnvironment["plugin"]["appServerContext"];
    };
    view?: Partial<ChatPanelEnvironment["view"]>;
  }

  function chatPanelEnvironmentFixture(overrides: PartialChatPanelEnvironment = {}): ChatPanelEnvironment {
    const threadCatalog = threadCatalogFixture(overrides.plugin?.threadCatalog);
    const appServerQueries = appServerQueriesFixture(overrides.plugin?.appServerQueries);
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
            offref: vi.fn(),
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
        requestWorkspaceLayoutSave: vi.fn(),
        isForeground: vi.fn(() => true),
        ...overrides.obsidian,
      },
      plugin: {
        appServerConnection: contextConnectionFixture(),
        appServerContext: overrides.plugin?.appServerContext ?? { codexPath: "codex", vaultPath: "/vault" },
        threadTitlePort: {
          persistedContext: vi.fn().mockResolvedValue(null),
          generateTitle: vi.fn().mockResolvedValue(null),
        },
        threadAutoTitleWork: { submit: vi.fn() },
        settings: overrides.plugin?.settings ?? chatPanelSettingsAccess(settingsSource),
        workspace: {
          openThreadInNewView: vi.fn().mockResolvedValue(undefined),
          openThreadInAvailableView: overrides.plugin?.workspace?.openThreadInAvailableView ?? vi.fn().mockResolvedValue(undefined),
          openTurnDiff: vi.fn().mockResolvedValue(undefined),
          notifyPanelActivityChanged: vi.fn(),
          ...overrides.plugin?.workspace,
          openThreadFromPanel: overrides.plugin?.workspace?.openThreadFromPanel ?? vi.fn().mockResolvedValue(undefined),
          openSideChat: overrides.plugin?.workspace?.openSideChat ?? vi.fn().mockResolvedValue(undefined),
        },
        appServerQueries,
        threadCatalog,
        threadFacts: {
          apply: overrides.plugin?.threadFacts?.apply ?? vi.fn(),
          applyBatch: overrides.plugin?.threadFacts?.applyBatch ?? vi.fn(),
        },
        threadReplacementPublication: {
          begin: vi.fn(() => ({ attach: vi.fn(), finish: vi.fn() })),
          visibleThreadId: vi.fn((_threads, threadId) => threadId),
        },
        threadMutations: threadMutationCommandsMock(),
        threadGoalCoordinator: createThreadGoalCoordinator(),
        runtimeSettingsCommitQueue: createKeyedOperationCoordinator({ whenBusy: "queue" }),
      },
      view: {
        panelRoot: () => panelRoot,
        viewWindow: () => window,
        refreshTabHeader: vi.fn(),
        ...overrides.view,
      },
    };
  }

  function contextConnectionFixture(): CodexChatHost["appServerConnection"] {
    return {
      createLease: () => ({
        connect: vi.fn().mockResolvedValue({
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex-test",
        }),
        currentClient: () => null,
        isConnected: () => false,
        disconnect: vi.fn(),
      }),
    };
  }

  function threadCatalogFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]> = {},
  ): ChatPanelEnvironment["plugin"]["threadCatalog"] {
    return {
      hasMoreActiveThreads: vi.fn(() => false),
      loadMoreActiveThreads: vi.fn().mockResolvedValue([]),
      fetchActiveThreads: vi.fn().mockResolvedValue([]),
      refreshActiveThreads: vi.fn().mockResolvedValue([]),
      activeThreadsSnapshot: vi.fn(() => null),
      recentActiveThreadsSnapshot: vi.fn(() => null),
      observeActiveThreadsResult: vi.fn(() => () => undefined),
      ...overrides,
    };
  }

  function appServerQueriesFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]> = {},
  ): ChatPanelEnvironment["plugin"]["appServerQueries"] {
    return {
      metadataSnapshot: vi.fn(() => null),
      metadataDiagnosticsSnapshot: vi.fn(() => createServerDiagnostics()),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
      refreshSkills: vi.fn().mockResolvedValue(undefined),
      refreshRateLimits: vi.fn().mockResolvedValue(undefined),
      fetchModels: vi.fn().mockResolvedValue([]),
      refreshModels: vi.fn().mockResolvedValue([]),
      observeMetadataResource: vi.fn(() => () => undefined),
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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaleAppServerSharedQueryContextError } from "../../../../src/app-server/query/shared-queries";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import type { Thread } from "../../../../src/domain/threads/model";
import { ChatResumeWorkTracker } from "../../../../src/features/chat/application/lifecycle";
import { type ChatStateStore, createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { HistoryController } from "../../../../src/features/chat/application/threads/history-controller";
import type { ChatPanelEnvironment } from "../../../../src/features/chat/host/contracts";
import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/deferred-work";
import { createChatPanelSessionGraph } from "../../../../src/features/chat/host/session-graph";
import { ChatComposerController } from "../../../../src/features/chat/panel/composer-controller";
import { MessageStreamPresenter } from "../../../../src/features/chat/panel/surface/message-stream-presenter";
import { createChatMessageScrollController } from "../../../../src/features/chat/panel/surface/message-stream-scroll";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { ConnectionWorkTracker } from "../../../../src/shared/lifecycle/connection-work";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

describe("createChatPanelSessionGraph actions", () => {
  let panelRoot: HTMLElement;

  beforeEach(() => {
    panelRoot = document.body.createDiv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("invalidates thread work through the graph action", () => {
    const { graph, resumeWork } = sessionGraphFixture();
    const resume = resumeWork.begin("thread-1");
    const invalidateHistory = vi.spyOn(HistoryController.prototype, "invalidate");

    graph.actions.invalidateThreadWork();

    expect(resumeWork.isStale(resume)).toBe(true);
    expect(invalidateHistory).toHaveBeenCalledOnce();
  });

  it("refreshes shared threads inside the graph connection bundle", async () => {
    const thread = threadFixture({ id: "thread-1", preview: "From catalog" });
    const refresh = vi.fn().mockResolvedValue([thread]);
    const { graph, stateStore } = sessionGraphFixture({
      environment: {
        plugin: {
          threadCatalog: {
            refreshActive: refresh,
          },
        },
      },
    });

    await graph.actions.refreshSharedThreads();

    expect(refresh).toHaveBeenCalledOnce();
    expect(stateStore.getState().threadList.listedThreads).toEqual([thread]);
    expect(stateStore.getState().threadList.threadsLoaded).toBe(true);
  });

  it("treats stale shared thread refreshes as graph-local no-ops", async () => {
    const refresh = vi.fn().mockRejectedValue(new StaleAppServerSharedQueryContextError());
    const { graph, stateStore } = sessionGraphFixture({
      environment: {
        plugin: {
          threadCatalog: {
            refreshActive: refresh,
          },
        },
      },
    });

    await expect(graph.actions.refreshSharedThreads()).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledOnce();
    expect(stateStore.getState().threadList.threadsLoaded).toBe(false);
  });

  it("applies cached shared state from the runtime binding", () => {
    const thread = threadFixture({ id: "thread-1", preview: "Cached thread" });
    const model = modelFixture({ id: "model-1", model: "gpt-cached" });
    const { graph, stateStore } = sessionGraphFixture({
      environment: {
        plugin: {
          threadCatalog: {
            activeSnapshot: vi.fn(() => [thread]),
          },
          appServerQueries: {
            modelsSnapshot: vi.fn(() => [model]),
          },
        },
      },
    });

    graph.runtime.sharedState.applyCached();

    expect(stateStore.getState().threadList.listedThreads).toEqual([thread]);
    expect(stateStore.getState().connection.availableModels).toEqual([model]);
  });

  it("subscribes and unsubscribes fixed shared state observers", () => {
    const cleanupThreads = vi.fn();
    const cleanupMetadata = vi.fn();
    const cleanupModels = vi.fn();
    const observeThreads = vi.fn(() => cleanupThreads);
    const observeMetadata = vi.fn(() => cleanupMetadata);
    const observeModels = vi.fn(() => cleanupModels);
    const { graph } = sessionGraphFixture({
      environment: {
        plugin: {
          threadCatalog: {
            observeActive: observeThreads,
          },
          appServerQueries: {
            observeAppServerMetadataResult: observeMetadata,
            observeModelsResult: observeModels,
          },
        },
      },
    });

    graph.runtime.sharedState.subscribe();
    graph.runtime.sharedState.unsubscribe();

    expect(observeThreads).toHaveBeenCalledWith(expect.any(Function), { emitCurrent: false });
    expect(observeMetadata).toHaveBeenCalledWith(expect.any(Function), { emitCurrent: false });
    expect(observeModels).toHaveBeenCalledWith(expect.any(Function), { emitCurrent: false });
    expect(cleanupThreads).toHaveBeenCalledOnce();
    expect(cleanupMetadata).toHaveBeenCalledOnce();
    expect(cleanupModels).toHaveBeenCalledOnce();
  });

  it("starts a new thread from graph state and composer actions", async () => {
    const focusComposer = vi.spyOn(ChatComposerController.prototype, "focusComposer").mockImplementation(() => undefined);
    const refreshLiveState = vi.fn();
    const requestWorkspaceLayoutSave = vi.fn();
    const refreshTabHeader = vi.fn();
    const { graph, stateStore } = sessionGraphFixture({
      environment: {
        obsidian: {
          requestWorkspaceLayoutSave,
        },
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
      thread: threadFixture({ id: "thread-1", preview: "Active" }),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await graph.actions.startNewThread();

    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(stateStore.getState().connection.statusText).toBe("New chat.");
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(refreshTabHeader).toHaveBeenCalledOnce();
    expect(requestWorkspaceLayoutSave).toHaveBeenCalledOnce();
    expect(refreshLiveState).toHaveBeenCalledOnce();
  });

  it("does not clear the current thread while a turn is busy", async () => {
    const focusComposer = vi.spyOn(ChatComposerController.prototype, "focusComposer").mockImplementation(() => undefined);
    const { graph, stateStore } = sessionGraphFixture();
    stateStore.dispatch({
      type: "turn/started",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    await graph.actions.startNewThread();

    expect(stateStore.getState().activeThread.id).toBe("thread-1");
    expect(focusComposer).not.toHaveBeenCalled();
  });

  it("disposes presenter and composer resources from the graph action", () => {
    const disposePresenter = vi.spyOn(MessageStreamPresenter.prototype, "dispose").mockImplementation(() => undefined);
    const disposeComposer = vi.spyOn(ChatComposerController.prototype, "dispose").mockImplementation(() => undefined);
    const { graph } = sessionGraphFixture();

    graph.actions.dispose();

    expect(disposePresenter).toHaveBeenCalledOnce();
    expect(disposeComposer).toHaveBeenCalledOnce();
  });

  function sessionGraphFixture(options: { environment?: PartialChatPanelEnvironment } = {}): {
    graph: ReturnType<typeof createChatPanelSessionGraph>;
    stateStore: ChatStateStore;
    resumeWork: ChatResumeWorkTracker;
  } {
    const stateStore = createChatStateStore();
    const resumeWork = new ChatResumeWorkTracker();
    const environment = chatPanelEnvironmentFixture(options.environment);
    const graph = createChatPanelSessionGraph({
      environment,
      stateStore,
      deferredTasks: createChatViewDeferredTasks(() => window),
      resumeWork,
      connectionWork: new ConnectionWorkTracker(),
      messageScrollController: createChatMessageScrollController(),
      getClosing: () => false,
      viewWindow: () => window,
    });
    return { graph, stateStore, resumeWork };
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
        ...overrides.obsidian,
      },
      plugin: {
        settingsRef: {
          settings: {
            ...DEFAULT_SETTINGS,
            codexPath: "codex",
            sendShortcut: "enter",
          },
          vaultPath: "/vault",
          ...overrides.plugin?.settingsRef,
        },
        workspace: {
          openThreadInNewView: vi.fn().mockResolvedValue(undefined),
          focusThreadInOpenView: vi.fn().mockResolvedValue(false),
          openTurnDiff: vi.fn().mockResolvedValue(undefined),
          refreshThreadsViewLiveState: vi.fn(),
          ...overrides.plugin?.workspace,
        },
        appServerQueries,
        threadCatalog,
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
      ...overrides,
    };
  }

  function appServerQueriesFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]> = {},
  ): ChatPanelEnvironment["plugin"]["appServerQueries"] {
    return {
      updateAppServerMetadata: vi.fn(() => null),
      appServerMetadataSnapshot: vi.fn(() => null),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
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
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  function modelFixture(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
    return {
      id: "model",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "",
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      inputModalities: [],
      additionalSpeedTiers: [],
      serviceTiers: [],
      defaultServiceTier: null,
      isDefault: false,
      ...overrides,
    };
  }
});

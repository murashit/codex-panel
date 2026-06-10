// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { App, Component, EventRef, WorkspaceLeaf } from "obsidian";

import type { RuntimeSnapshot } from "../../../../src/features/chat/runtime/effective-settings";
import { createChatStateStore } from "../../../../src/features/chat/chat-state";
import { createChatViewControllers } from "../../../../src/features/chat/panel/composition";
import type { ChatControllerCompositionPorts } from "../../../../src/features/chat/panel/controller-ports";
import { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "../../../../src/features/chat/panel/lifecycle";
import { ChatMessageScrollIntentController } from "../../../../src/features/chat/panel/message-scroll-intent-controller";
import type { ComposerMetaViewModel } from "../../../../src/features/chat/panel/model";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";

describe("createChatViewControllers", () => {
  it("constructs the chat controller graph and exposes slot renderer attachment", () => {
    const controllers = createChatViewControllers(createPorts());

    expect(controllers.connection.controller).toBeTruthy();
    expect(controllers.inbound.controller).toBeTruthy();
    expect(controllers.thread.resume).toBeTruthy();
    expect(controllers.render.messages).toBeTruthy();
    expect(controllers.composer.controller).toBeTruthy();
    expect(() => {
      controllers.render.attachSlotRenderers({
        renderToolbar: vi.fn(),
        renderGoal: vi.fn(),
        renderMessages: vi.fn(),
        renderComposer: vi.fn(),
      });
    }).not.toThrow();
  });
});

function createPorts(): ChatControllerCompositionPorts {
  const stateStore = createChatStateStore();
  const deferredTasks = new ChatViewDeferredTasks(() => window);
  const root = document.createElement("div");

  return {
    obsidian: {
      app: createApp(),
      owner: createOwner(),
      viewId: "test-view",
      registerEvent: vi.fn(),
      registerPointerDown: vi.fn(),
      registerActiveLeafChange: vi.fn(),
      handleActiveLeafChange: vi.fn((_leaf: WorkspaceLeaf | null) => undefined),
      archiveAdapter: () => ({
        exists: vi.fn().mockResolvedValue(false),
        mkdir: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
      }),
    },
    plugin: {
      settings: DEFAULT_SETTINGS,
      vaultPath: "/vault",
      openThreadInNewView: vi.fn().mockResolvedValue(undefined),
      focusThreadInOpenView: vi.fn().mockResolvedValue(false),
      openTurnDiff: vi.fn().mockResolvedValue(undefined),
      notifyThreadArchived: vi.fn(),
      notifyThreadRenamed: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
      refreshSharedThreadListFromOpenSurface: vi.fn(),
      applyThreadListSnapshot: vi.fn(),
      refreshThreadList: vi.fn(async (fetchThreads: () => Promise<readonly []>) => fetchThreads()),
      cachedThreadList: () => null,
      publishAppServerMetadata: vi.fn(),
      cachedAppServerMetadata: () => null,
    },
    state: {
      stateStore,
      getState: () => stateStore.getState(),
      systemItem: (text) => ({ id: "system", kind: "system", role: "system", text }),
    },
    client: {
      getClient: () => null,
      setClient: vi.fn(),
      clear: vi.fn(),
    },
    lifecycle: {
      deferredTasks,
      resumeWork: new ChatResumeWorkTracker(),
      connectionWork: new ChatConnectionWorkTracker(),
      messageScrollIntent: new ChatMessageScrollIntentController(),
      getOpened: () => false,
      setOpened: vi.fn(),
      getClosing: () => false,
      setClosing: vi.fn(),
      invalidateConnectionWork: vi.fn(),
      scheduleDeferredDiagnostics: vi.fn(),
      clearDeferredDiagnostics: vi.fn(),
      scheduleDeferredRestoredThreadHydration: vi.fn(),
      clearDeferredRestoredThreadHydration: vi.fn(),
      scheduleDeferredAppServerWarmup: vi.fn(),
    },
    render: {
      panelRoot: () => root,
      pendingRequestsSignature: () => "",
      activeComposerThreadName: () => null,
      composerPlaceholder: () => "",
      composerMetaViewModel: () => composerMeta(),
      closeToolbarPanelOnOutsidePointer: vi.fn(),
      schedule: vi.fn(),
    },
    runtime: {
      runtimeSnapshot: () => ({}) as RuntimeSnapshot,
      collaborationModeLabel: () => "Plan",
      connectionDiagnosticDetails: () => [],
      modelStatusLines: () => [],
      effortStatusLines: () => [],
      statusSummaryLines: () => [],
    },
    thread: {
      ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(false),
      startNewThread: vi.fn().mockResolvedValue(undefined),
      loadSharedThreadList: vi.fn().mockResolvedValue(undefined),
      notifyIdentityChanged: vi.fn(),
      refreshTabHeader: vi.fn(),
    },
    liveState: {
      refresh: vi.fn(),
      deferRefresh: vi.fn(),
    },
    scroll: {
      forceBottom: vi.fn(),
      preservePosition: vi.fn(),
    },
    status: {
      set: vi.fn(),
    },
  };
}

function createApp(): App {
  return {
    vault: {
      adapter: {},
      on: vi.fn(() => ({}) as EventRef),
    },
    workspace: {
      getActiveFile: () => null,
      openLinkText: vi.fn(),
    },
  } as unknown as App;
}

function createOwner(): Component {
  return {} as Component;
}

function composerMeta(): ComposerMetaViewModel {
  return {
    fatal: null,
    context: { cells: [], percent: "--%" },
    statusSummary: "",
    model: "",
    effort: null,
    planActive: false,
    autoReviewActive: false,
    fastActive: false,
  };
}

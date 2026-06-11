import type { ConnectionManager } from "../../../app-server/connection-manager";
import type { ComponentChild as UiNode } from "preact";
import type { ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { ChatServerMetadataActions } from "../server-actions/metadata-actions";
import type { ChatServerThreadActions } from "../server-actions/thread-actions";
import type { ChatComposerController } from "../composer/controller";
import type { ChatThreadActions } from "../threads/thread-actions";
import { scheduleAppServerWarmup } from "../session/app-server-warmup-controller";
import { closeChatView, openChatView, type ChatViewLifecycleHost } from "./view-lifecycle";
import { ToolbarPanelController } from "./toolbar-controller";
import { ChatViewRenderController } from "./view-render-controller";
import { applyChatViewState } from "./view-state-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import { applyCachedSharedAppServerState, type CachedSharedAppServerStateSource } from "./cached-app-server-state";
import type { ChatViewDeferredTasks, RestoredThreadState } from "./lifecycle";
import { createChatShellRenderPort } from "./shell-render";
import { createToolbarArchiveConfirmState } from "./toolbar-archive-confirm-state";

interface ViewRenderControllerGroupPorts {
  plugin: Pick<CodexChatHost, "settings">;
  state: {
    stateStore: ChatStateStore;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
  };
  render: {
    panelRoot: () => HTMLElement | null;
    toolbarNode: () => UiNode;
    goalNode: () => UiNode;
    messagesNode: () => UiNode;
    composerNode: () => UiNode;
  };
}

export function createViewRenderControllerGroup(context: ViewRenderControllerGroupPorts) {
  const { plugin, render, lifecycle } = context;
  const { deferredTasks } = lifecycle;

  return {
    renderController: new ChatViewRenderController({
      shell: createChatShellRenderPort(context.state.stateStore, {
        showToolbar: () => plugin.settings.showToolbar,
        toolbarNode: context.render.toolbarNode,
        goalNode: context.render.goalNode,
        messagesNode: context.render.messagesNode,
        composerNode: context.render.composerNode,
      }),
      panelRoot: render.panelRoot,
      clearScheduledRender: () => {
        deferredTasks.clearRender();
      },
    }),
  };
}

interface ConnectionLifecycleControllerGroupPorts {
  obsidian: Pick<ChatViewLifecycleHost, "registerEvent" | "registerPointerDown">;
  plugin: CachedSharedAppServerStateSource;
  client: {
    clear: () => void;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    getOpened: () => boolean;
    setOpened: (opened: boolean) => void;
    getClosing: () => boolean;
    setClosing: (closing: boolean) => void;
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    scheduleDeferredRestoredThreadHydration: () => void;
    scheduleDeferredAppServerWarmup: () => void;
  };
  render: {
    panelRoot: () => HTMLElement | null;
    closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
    now: () => void;
  };
  liveState: {
    refresh: () => void;
    deferRefresh: () => void;
  };
}

export function createConnectionLifecycleControllerGroup(
  context: ConnectionLifecycleControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
    composerController: ChatComposerController;
    messageRenderer: ChatMessageRenderer;
    serverThreads: ChatServerThreadActions;
    serverMetadata: ChatServerMetadataActions;
  },
) {
  const { obsidian, plugin, lifecycle, render, liveState, client } = context;
  const { deferredTasks } = lifecycle;

  const warmupHost = {
    deferredTasks,
    opened: lifecycle.getOpened,
    closing: lifecycle.getClosing,
    connected: () => refs.connection.isConnected(),
    ensureConnected: client.ensureConnected,
  };

  const viewLifecycleHost: ChatViewLifecycleHost = {
    setOpened: lifecycle.setOpened,
    setClosing: lifecycle.setClosing,
    registerEvent: obsidian.registerEvent,
    registerComposerNoteIndexInvalidation: (register) => {
      refs.composerController.registerNoteIndexInvalidation(register);
    },
    registerPointerDown: obsidian.registerPointerDown,
    applyCachedSharedAppServerState: () => {
      applyCachedSharedAppServerState(plugin, refs.serverThreads, refs.serverMetadata);
    },
    render: render.now,
    scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
    scheduleDeferredRestoredThreadHydration: lifecycle.scheduleDeferredRestoredThreadHydration,
    closeToolbarPanelOnOutsidePointer: render.closeToolbarPanelOnOutsidePointer,
    invalidateConnectionWork: lifecycle.invalidateConnectionWork,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredTasks: () => {
      deferredTasks.clearAll();
    },
    panelRoot: render.panelRoot,
    disposeMessages: () => {
      refs.messageRenderer.dispose();
    },
    disposeComposer: () => {
      refs.composerController.dispose();
    },
    disconnect: () => {
      refs.connection.disconnect();
    },
    clearClient: client.clear,
    refreshLiveState: liveState.refresh,
    deferRefreshLiveState: liveState.deferRefresh,
  };

  return {
    scheduleAppServerWarmup: () => {
      scheduleAppServerWarmup(warmupHost);
    },
    openView: () => {
      openChatView(viewLifecycleHost);
    },
    closeView: () => {
      closeChatView(viewLifecycleHost);
    },
  };
}

interface PanelUiControllerGroupPorts {
  state: {
    stateStore: ChatStateStore;
  };
  lifecycle: {
    invalidateResumeWork: () => void;
    clearDeferredRestoredThreadHydration: () => void;
    scheduleDeferredAppServerWarmup: () => void;
  };
  render: {
    schedule: () => void;
  };
  thread: {
    clearRestoredLifecycle: () => void;
    restorePlaceholder: (restoredThread: RestoredThreadState) => void;
  };
}

export function createPanelUiControllerGroup(
  context: PanelUiControllerGroupPorts,
  refs: {
    threadActions: ChatThreadActions;
  },
) {
  const { lifecycle, render, thread } = context;

  const viewStateHost = {
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: thread.restorePlaceholder,
  };

  const toolbarPanels = new ToolbarPanelController({
    stateStore: context.state.stateStore,
    threadActions: refs.threadActions,
    archiveConfirm: createToolbarArchiveConfirmState(),
    scheduleRender: render.schedule,
  });
  const applyViewState = (state: unknown) => {
    applyChatViewState(viewStateHost, state);
  };

  return { toolbarPanels, applyViewState };
}

import type { ConnectionManager } from "../../../app-server/connection-manager";
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
import { applyCachedSharedAppServerState } from "./cached-app-server-state";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import { createChatShellRenderPort } from "./shell-render";

type ViewRenderControllerGroupPorts = Pick<ChatControllerCompositionPorts, "lifecycle" | "plugin" | "render" | "state">;

export function createViewRenderControllerGroup(
  context: ViewRenderControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { plugin, render, lifecycle } = context;
  const { deferredTasks } = lifecycle;

  return {
    renderController: new ChatViewRenderController({
      shell: createChatShellRenderPort(context.state.stateStore, {
        connected: () => refs.connection.isConnected(),
        showToolbar: () => plugin.settings.showToolbar,
        pendingRequestsSignature: render.pendingRequestsSignature,
        activeComposerThreadName: render.activeComposerThreadName,
      }),
      panelRoot: render.panelRoot,
      renderToolbar: render.renderToolbar,
      renderGoal: render.renderGoal,
      renderMessages: render.renderMessages,
      renderComposer: render.renderComposer,
      clearScheduledRender: () => {
        deferredTasks.clearRender();
      },
    }),
  };
}

type ConnectionLifecycleControllerGroupPorts = Pick<
  ChatControllerCompositionPorts,
  "client" | "lifecycle" | "liveState" | "obsidian" | "plugin" | "render"
>;

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
    registerActiveLeafChange: obsidian.registerActiveLeafChange,
    handleActiveLeafChange: obsidian.handleActiveLeafChange,
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

type PanelUiControllerGroupPorts = Pick<ChatControllerCompositionPorts, "lifecycle" | "render" | "state" | "thread">;

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
    scheduleRender: render.schedule,
  });
  const applyViewState = (state: unknown) => {
    applyChatViewState(viewStateHost, state);
  };

  return { toolbarPanels, applyViewState };
}

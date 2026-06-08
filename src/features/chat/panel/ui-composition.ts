import type { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatAppServerMetadataActions } from "../app-server/metadata-actions";
import type { ChatAppServerThreadActions } from "../app-server/thread-actions";
import type { ChatComposerController } from "../composer/controller";
import type { ChatThreadActions } from "../threads/thread-actions";
import { createAppServerWarmupActions } from "../session/app-server-warmup-controller";
import { createChatViewOpenCloseActions } from "./open-close-actions";
import { ToolbarPanelController } from "./toolbar-controller";
import { ChatViewRenderController } from "./view-render-controller";
import { createChatViewStateActions } from "./view-state-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import { applyCachedSharedAppServerState } from "./cached-app-server-state";
import type { ChatPanelContext } from "./context";
import { createChatShellRenderPort } from "./shell-render";

export function createViewRenderControllerGroup(
  context: ChatPanelContext,
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

export function createConnectionLifecycleControllerGroup(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
    composerController: ChatComposerController;
    messageRenderer: ChatMessageRenderer;
    appServerThreads: ChatAppServerThreadActions;
    appServerMetadata: ChatAppServerMetadataActions;
  },
) {
  const { obsidian, lifecycle, render, liveState, scroll, client } = context;
  const { deferredTasks } = lifecycle;

  return {
    appServerWarmup: createAppServerWarmupActions({
      deferredTasks,
      opened: lifecycle.getOpened,
      closing: lifecycle.getClosing,
      connected: () => refs.connection.isConnected(),
      ensureConnected: client.ensureConnected,
    }),
    openCloseController: createChatViewOpenCloseActions({
      setOpened: lifecycle.setOpened,
      setClosing: lifecycle.setClosing,
      registerEvent: obsidian.registerEvent,
      registerComposerNoteIndexInvalidation: (register) => {
        refs.composerController.registerNoteIndexInvalidation(register);
      },
      registerPointerDown: obsidian.registerPointerDown,
      registerActiveLeafChange: obsidian.registerActiveLeafChange,
      isOwnLeaf: obsidian.isOwnLeaf,
      scrollMessagesToBottomOnFocus: scroll.bottomOnFocus,
      applyCachedSharedAppServerState: () => {
        applyCachedSharedAppServerState(context, refs.appServerThreads, refs.appServerMetadata);
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
    }),
  };
}

export function createPanelUiControllerGroup(
  context: ChatPanelContext,
  refs: {
    threadActions: ChatThreadActions;
  },
) {
  const { lifecycle, render, thread } = context;

  const toolbarPanels = new ToolbarPanelController({
    stateStore: context.state.stateStore,
    threadActions: refs.threadActions,
    scheduleRender: render.schedule,
  });
  const viewStateController = createChatViewStateActions({
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: thread.restorePlaceholder,
  });

  return { toolbarPanels, viewStateController };
}

import type { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import type { ChatAppServerThreadController } from "../app-server/thread-controller";
import type { ChatComposerController } from "../composer/controller";
import { createAppServerWarmupActions } from "../controllers/connection/app-server-warmup-controller";
import { ChatViewOpenCloseController } from "../controllers/view/view-open-close-controller";
import { ChatViewRenderController } from "../controllers/view/view-render-controller";
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
    appServerThreads: ChatAppServerThreadController;
    appServerMetadata: ChatAppServerMetadataController;
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
    openCloseController: new ChatViewOpenCloseController({
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

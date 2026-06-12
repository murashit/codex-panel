import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { ChatServerMetadataActions } from "../connection/server-actions/metadata";
import type { ChatServerThreadActions } from "../connection/server-actions/threads";
import type { ChatComposerController } from "../conversation/composer/controller";
import type { ChatThreadActions } from "../threads/action-context";
import { closeChatView, openChatView, type ChatViewLifecycleHost } from "./view-lifecycle";
import { createToolbarArchiveConfirmState, createToolbarPanelActions } from "./regions/toolbar";
import { applyChatViewState } from "./view-state";
import type { MessageStreamRenderer } from "../ui/message-stream/renderer";
import type { ChatViewDeferredTasks, RestoredThreadState } from "../lifecycle";
import type { ChatControllerCompositionPorts } from "../composition-ports";
import { renderChatPanelShell } from "../ui/shell";

export interface CachedSharedAppServerStateSource {
  cachedThreadList: () => readonly Thread[] | null;
  cachedAppServerMetadata: () => SharedServerMetadata | null;
}

type ChatViewRendererPorts = Pick<ChatControllerCompositionPorts, "plugin" | "state" | "lifecycle" | "render">;

export function createChatViewRenderer(context: ChatViewRendererPorts): () => void {
  const { plugin, render, lifecycle } = context;
  const { deferredTasks } = lifecycle;

  return () => {
    deferredTasks.clearRender();
    const root = render.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: context.state.stateStore,
      showToolbar: plugin.settings.showToolbar,
      toolbarNode: context.render.toolbarNode,
      goalNode: context.render.goalNode,
      messageStreamNode: context.render.messageStreamNode,
      composerNode: context.render.composerNode,
    });
  };
}

type ConnectionLifecycleControllerGroupPorts = Pick<ChatControllerCompositionPorts, "plugin" | "liveState"> & {
  obsidian: Pick<ChatViewLifecycleHost["events"], "registerEvent" | "registerPointerDown">;
  plugin: CachedSharedAppServerStateSource;
  client: {
    clear: () => void;
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
};

export function createConnectionLifecycleControllerGroup(
  context: ConnectionLifecycleControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
    composerController: ChatComposerController;
    messageStreamRenderer: MessageStreamRenderer;
    serverThreads: ChatServerThreadActions;
    serverMetadata: ChatServerMetadataActions;
  },
) {
  const { obsidian, plugin, lifecycle, render, liveState, client } = context;
  const { deferredTasks } = lifecycle;

  const viewLifecycleHost: ChatViewLifecycleHost = {
    lifecycle: {
      setOpened: lifecycle.setOpened,
      setClosing: lifecycle.setClosing,
      invalidateConnectionWork: lifecycle.invalidateConnectionWork,
      invalidateResumeWork: lifecycle.invalidateResumeWork,
      clearDeferredTasks: () => {
        deferredTasks.clearAll();
      },
      scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
      scheduleDeferredRestoredThreadHydration: lifecycle.scheduleDeferredRestoredThreadHydration,
    },
    events: {
      registerEvent: obsidian.registerEvent,
      registerComposerNoteIndexInvalidation: (register) => {
        refs.composerController.registerNoteIndexInvalidation(register);
      },
      registerPointerDown: obsidian.registerPointerDown,
      closeToolbarPanelOnOutsidePointer: render.closeToolbarPanelOnOutsidePointer,
    },
    render: {
      panelRoot: render.panelRoot,
      now: render.now,
    },
    sharedState: {
      applyCachedAppServerState: () => {
        applyCachedSharedAppServerState(plugin, refs.serverThreads, refs.serverMetadata);
      },
    },
    resources: {
      disposeMessages: () => {
        refs.messageStreamRenderer.dispose();
      },
      disposeComposer: () => {
        refs.composerController.dispose();
      },
      disconnect: () => {
        refs.connection.disconnect();
      },
      clearClient: client.clear,
    },
    liveState: {
      refresh: liveState.refresh,
      deferRefresh: liveState.deferRefresh,
    },
  };

  return {
    openView: () => {
      openChatView(viewLifecycleHost);
    },
    closeView: () => {
      closeChatView(viewLifecycleHost);
    },
  };
}

type PanelUiControllerGroupPorts = Pick<ChatControllerCompositionPorts, "state"> & {
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
};

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

  const toolbarPanels = createToolbarPanelActions({
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

function applyCachedSharedAppServerState(
  source: CachedSharedAppServerStateSource,
  serverThreads: ChatServerThreadActions,
  serverMetadata: ChatServerMetadataActions,
): void {
  const threads = source.cachedThreadList();
  if (threads) serverThreads.applyThreadList(threads);
  const metadata = source.cachedAppServerMetadata();
  if (metadata) serverMetadata.applyAppServerMetadata(metadata);
}

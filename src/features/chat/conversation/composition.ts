import type { App, Component } from "obsidian";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatServerThreadActions } from "../connection/server-actions/threads";
import { type ChatStateStore } from "../state/reducer";
import type { ChatReconnectActions } from "../connection/reconnect-actions";
import { PendingRequestController } from "./pending-requests/controller";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { ThreadManagementActions } from "../threads/thread-management-actions";
import type { GoalActions } from "../threads/goal-actions";
import type { HistoryController } from "../threads/history-controller";
import type { ChatInboundController } from "../protocol/inbound/controller";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/model/items";
import type { ChatMessageScrollIntentState } from "../ui/message-stream/scroll-intent-state";
import type { ComposerMetaViewModel } from "../ui/composer";
import type { ChatPanelComposerShellState } from "../ui/shell-state";
import type { CodexChatHost } from "../chat-host";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { createConversationComposer } from "./composer/composition";
import { createConversationTurnActions } from "./turns/composition";

interface ConversationPartsContext {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
  };
  plugin: CodexChatHost;
  state: {
    stateStore: ChatStateStore;
  };
  lifecycle: {
    messageScrollIntent: ChatMessageScrollIntentState;
  };
  surface: {
    pendingRequestsSignature: () => string;
    composerProjection: (state: ChatPanelComposerShellState) => {
      placeholder: string;
      meta: ComposerMetaViewModel;
    };
  };
  runtime: {
    connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
    modelStatusLines: () => string[];
    effortStatusLines: () => string[];
    statusSummaryLines: () => string[];
    mcpStatusLines: () => Promise<string[]>;
  };
  liveState: {
    refresh: () => void;
  };
  client: {
    getClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
  };
  scroll: {
    forceBottom: () => void;
    followBottom: () => void;
  };
  thread: {
    ensureRestoredThreadLoaded: () => Promise<boolean>;
    startNewThread: () => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
  };
}

export function createConversationParts(
  context: ConversationPartsContext,
  refs: {
    controller: ChatInboundController;
    serverThreads: ChatServerThreadActions;
    runtimeSettings: ChatRuntimeSettingsActions;
    threadActions: ThreadManagementActions;
    reconnectActions: ChatReconnectActions;
    goals: GoalActions;
    history: HistoryController;
  },
) {
  const { plugin, state, surface, runtime, thread, liveState, status, lifecycle, client, scroll } = context;
  const { app, owner, viewId } = context.obsidian;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;

  const composer = createConversationComposer(
    {
      app,
      plugin,
      stateStore,
      viewId,
      surface: {
        composerProjection: surface.composerProjection,
      },
      liveState: {
        refresh: liveState.refresh,
      },
    },
    {
      runtimeSettings: refs.runtimeSettings,
    },
  );
  const composerController = composer.controller;
  const messageStreamScrollBridge = composer.scrollBridge;

  const pendingRequests = new PendingRequestController({
    stateStore,
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
  });

  const turnActions = createConversationTurnActions(
    {
      vaultPath: plugin.vaultPath,
      stateStore,
      client: {
        currentClient,
        ensureConnected: client.ensureConnected,
      },
      status,
      runtime,
      thread,
      composer: {
        codexInput: composer.codexInput,
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: composer.setDraft,
      },
      scroll: {
        followBottom: scroll.followBottom,
      },
    },
    {
      serverThreads: refs.serverThreads,
      runtimeSettings: refs.runtimeSettings,
      threadActions: refs.threadActions,
      reconnectActions: refs.reconnectActions,
      goals: refs.goals,
    },
  );

  const messageStreamPresenter = new MessageStreamPresenter({
    obsidian: {
      app,
      owner,
    },
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: plugin.vaultPath,
    },
    scroll: {
      consumeIntent: () => lifecycle.messageScrollIntent.consumeIntent(),
      registerVirtualizer: messageStreamScrollBridge.registerVirtualizer,
      dispose: () => {
        messageStreamScrollBridge.dispose();
      },
    },
    history: {
      loadOlderTurns: () => void refs.history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void refs.threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void refs.threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (item: MessageStreamItem) => void turnActions.planImplementation.implement(item),
      openTurnDiff: (state) => void plugin.openTurnDiff(state),
    },
    requests: {
      pendingSignature: surface.pendingRequestsSignature,
      pendingSnapshot: () => pendingRequests.snapshot(),
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });

  return {
    pendingRequests,
    messageStreamPresenter,
    composerController,
    composerSubmit: turnActions.composerSubmit,
  };
}

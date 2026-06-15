import type { App, Component } from "obsidian";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../application/state/store";
import { PendingRequestController } from "../application/pending-requests/controller";
import type { ChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import type { ThreadManagementActions } from "../application/threads/thread-management-actions";
import type { GoalActions } from "../application/threads/goal-actions";
import type { HistoryController } from "../application/threads/history-controller";
import type { ChatInboundController } from "../app-server/inbound/controller";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import type { PluginSettingsRef, WorkspacePanels } from "../application/ports/chat-host";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import type { ChatMessageScrollIntentState } from "../panel/surface/message-stream-scroll-intent";
import type { ConversationComposerParts } from "./composer";
import { createConversationTurnActions, type ConversationThreadStarter } from "../application/conversation/composition";

interface ConversationPartsContext {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
  };
  settingsRef: PluginSettingsRef;
  workspace: WorkspacePanels;
  state: {
    stateStore: ChatStateStore;
  };
  composer: ConversationComposerParts;
  lifecycle: {
    messageScrollIntent: ChatMessageScrollIntentState;
  };
  surface: {
    pendingRequestsSignature: () => string;
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
    threadStarter: ConversationThreadStarter;
    runtimeSettings: ChatRuntimeSettingsActions;
    threadActions: ThreadManagementActions;
    reconnectPanel: () => Promise<void>;
    goals: GoalActions;
    history: HistoryController;
  },
) {
  const { settingsRef, workspace, state, composer, surface, runtime, thread, liveState, status, lifecycle, client, scroll } = context;
  const { app, owner } = context.obsidian;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;
  const composerController = composer.controller;
  const messageStreamScrollBridge = composer.scrollBridge;

  const pendingRequests = new PendingRequestController({
    stateStore,
    responder: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
  });

  const turnActions = createConversationTurnActions(
    {
      vaultPath: settingsRef.vaultPath,
      stateStore,
      client: {
        currentClient,
        ensureConnected: client.ensureConnected,
      },
      status,
      runtime,
      thread,
      composer: {
        codexInput: (text) => composerController.codexInput(text),
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: (text, options) => {
          composerController.setDraft(text, options);
        },
      },
      scroll: {
        followBottom: scroll.followBottom,
      },
    },
    {
      threadStarter: refs.threadStarter,
      runtimeSettings: refs.runtimeSettings,
      threadActions: refs.threadActions,
      reconnectPanel: refs.reconnectPanel,
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
      vaultPath: settingsRef.vaultPath,
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
      openTurnDiff: (state) => void workspace.openTurnDiff(state),
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

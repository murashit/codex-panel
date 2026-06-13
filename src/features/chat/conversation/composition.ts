import type { App, Component } from "obsidian";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatServerThreadActions } from "../connection/server-actions/threads";
import { type ChatStateStore } from "../state/reducer";
import type { ChatReconnectActions } from "../connection/reconnect-actions";
import { PendingRequestController } from "./pending-requests/controller";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { ChatThreadActions } from "../threads/action-context";
import type { GoalActions } from "../threads/goal-actions";
import type { HistoryController } from "../threads/history-controller";
import type { ChatInboundController } from "../protocol/inbound/controller";
import type { DisplayDetailSection } from "../display/types";
import type { ChatMessageScrollIntentState } from "../ui/message-stream/scroll-intent-state";
import type { ComposerMetaViewModel } from "../ui/composer";
import type { ChatPanelComposerShellState } from "../ui/shell-state";
import type { CodexChatHost } from "../chat-host";
import { createConversationComposer } from "./composer/composition";
import { createConversationMessageStreamPresenter } from "./message-stream/composition";
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
    composerPlaceholder: (state: ChatPanelComposerShellState) => string;
    composerMetaViewModel: (state: ChatPanelComposerShellState) => ComposerMetaViewModel;
  };
  runtime: {
    connectionDiagnosticDetails: () => DisplayDetailSection[];
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
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
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
    threadActions: ChatThreadActions;
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
        composerPlaceholder: surface.composerPlaceholder,
        composerMetaViewModel: surface.composerMetaViewModel,
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

  const messageStreamPresenter = createConversationMessageStreamPresenter(
    {
      obsidian: {
        app,
        owner,
      },
      plugin,
      stateStore,
      lifecycle,
      scroll: {
        bridge: messageStreamScrollBridge,
      },
      surface: {
        pendingRequestsSignature: surface.pendingRequestsSignature,
      },
    },
    {
      history: refs.history,
      threadActions: refs.threadActions,
      pendingRequests,
      planImplementation: turnActions.planImplementation,
    },
  );

  return {
    pendingRequests,
    messageStreamPresenter,
    composerController,
    composerSubmit: turnActions.composerSubmit,
  };
}

import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { LocalIdSource } from "../../../shared/id/local-id";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import type { ChatServerThreadActions } from "../app-server/actions/threads";
import type { ChatInboundHandler } from "../app-server/inbound/handler";
import { type ChatReconnectActionsHost, reconnectPanel } from "../application/connection/reconnect-actions";
import {
  type ConversationTurnActions as ChatPanelConversationTurnActions,
  createConversationTurnActions,
} from "../application/conversation/composition";
import type { ChatViewDeferredTasks } from "../application/lifecycle";
import { createPendingRequestActions, type PendingRequestActions } from "../application/pending-requests/pending-request-actions";
import type { ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { AutoTitleCoordinator } from "../application/threads/auto-title-coordinator";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import type { ChatComposerController } from "../panel/composer-controller";
import type { CurrentAppServerClient } from "./connection-bundle";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatPanelRuntimeProjection, ChatPanelRuntimeSettingsActions } from "./runtime-bundle";
import type {
  ChatPanelGoalActions,
  ChatPanelThreadActions,
  ChatPanelThreadLifecycle,
  ChatPanelThreadNavigationActions,
} from "./thread-bundle";

interface ChatPanelTurnStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

interface ChatPanelTurnHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  deferredTasks: ChatViewDeferredTasks;
  connectionWork: ConnectionWorkTracker;
  messageScrollController: {
    showLatest(): void;
  };
}

export interface ChatPanelTurnBundle {
  pendingRequests: PendingRequestActions;
  reconnect: () => Promise<void>;
  turnActions: ChatPanelConversationTurnActions;
}

interface ChatPanelTurnInput {
  connection: ConnectionManager;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  connectedClient: () => Promise<ReturnType<CurrentAppServerClient>>;
  currentClient: CurrentAppServerClient;
  status: ChatPanelTurnStatus;
  inboundHandler: ChatInboundHandler;
  threadLifecycle: ChatPanelThreadLifecycle;
  threadActions: ChatPanelThreadActions;
  navigation: ChatPanelThreadNavigationActions;
  composerController: ChatComposerController;
  runtimeSettings: ChatPanelRuntimeSettingsActions;
  serverThreads: ChatServerThreadActions;
  goals: ChatPanelGoalActions;
  autoTitleCoordinator: AutoTitleCoordinator;
  invalidateThreadWork: () => void;
  runtimeProjection: ChatPanelRuntimeProjection;
  refreshLiveState: () => void;
  notifyActiveThreadIdentityChanged: () => void;
}

export function createTurnBundle(host: ChatPanelTurnHost, input: ChatPanelTurnInput): ChatPanelTurnBundle {
  const {
    connection,
    localItemIds,
    ensureConnected,
    connectedClient,
    currentClient,
    status,
    inboundHandler,
    threadLifecycle,
    threadActions,
    navigation,
    composerController,
    runtimeSettings,
    serverThreads,
    goals,
    autoTitleCoordinator,
    invalidateThreadWork,
    runtimeProjection,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  } = input;
  const pendingRequests = createPendingRequestActions({
    stateStore: host.stateStore,
    responder: inboundHandler,
    composerHasFocus: () => composerController.hasFocus(),
    focusComposer: () => {
      composerController.focusComposer();
    },
    refreshLiveState,
  });
  const reconnectHost: ChatReconnectActionsHost = {
    stateStore: host.stateStore,
    invalidateConnectionWork: () => {
      host.connectionWork.invalidate();
    },
    invalidateThreadWork: () => {
      invalidateThreadWork();
    },
    clearDeferredDiagnostics: () => {
      host.deferredTasks.clearDiagnostics();
    },
    resetConnection: () => {
      connection.resetConnection();
    },
    setStatus: (statusText, phase) => {
      status.set(statusText, phase);
    },
    ensureConnected,
    resumeThread: (threadId) => threadLifecycle.resume.resumeThread(threadId),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  };
  const reconnect = () => reconnectPanel(reconnectHost);
  const turnActions = createConversationTurnActions(
    {
      vaultPath: host.environment.plugin.settingsRef.vaultPath,
      stateStore: host.stateStore,
      localItemIds,
      client: {
        currentClient,
        connectedClient,
      },
      status,
      runtime: {
        connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
        modelStatusLines: runtimeProjection.modelStatusLines,
        effortStatusLines: runtimeProjection.effortStatusLines,
        statusSummaryLines: runtimeProjection.statusSummaryLines,
        toolInventoryDetails: runtimeProjection.toolInventoryDetails,
      },
      thread: {
        ensureRestoredThreadLoaded: () =>
          threadLifecycle.restoration.ensureLoaded((threadId) => threadLifecycle.resume.resumeThread(threadId)),
        startNewThread: () => navigation.startNewThread(),
        selectThread: (threadId) => navigation.selectThread(threadId),
        notifyIdentityChanged: notifyActiveThreadIdentityChanged,
        resetTurnPresence: (hadTurns) => {
          autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
        },
      },
      composer: {
        codexInput: (text) => composerController.codexInput(text),
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: (text, options) => {
          composerController.setDraft(text, options);
        },
      },
      scroll: {
        showLatest: () => {
          host.messageScrollController.showLatest();
        },
      },
    },
    {
      threadStarter: serverThreads,
      runtimeSettings,
      threadActions,
      reconnectPanel: reconnect,
      goals,
    },
  );

  return {
    pendingRequests,
    reconnect,
    turnActions,
  };
}

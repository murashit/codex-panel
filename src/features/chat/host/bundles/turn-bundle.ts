import type { ChatServerThreadActions } from "../../app-server/actions/threads";
import type { ChatInboundHandler } from "../../app-server/inbound/handler";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import {
  type ConversationTurnActions as ChatPanelConversationTurnActions,
  createConversationTurnActions,
} from "../../application/conversation/composition";
import type { LocalIdSource } from "../../application/local-id-source";
import { createPendingRequestActions, type PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import type { ChatComposerController } from "../../panel/composer-controller";
import type { ChatPanelRuntimeProjection } from "../../panel/runtime-status-projection";
import type { ChatPanelRuntimeSettingsActions } from "./runtime-bundle";
import type {
  ChatPanelGoalActions,
  ChatPanelThreadActions,
  ChatPanelThreadLifecycle,
  ChatPanelThreadNavigationActions,
} from "./thread-bundle";

interface ChatPanelTurnStatus {
  set: (statusText: string) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

interface ChatPanelTurnHost {
  stateStore: ChatStateStore;
  messageScrollBinding: {
    showLatest(): void;
  };
}

export interface ChatPanelTurnBundle {
  pendingRequests: PendingRequestActions;
  turnActions: ChatPanelConversationTurnActions;
}

interface ChatPanelTurnInput {
  localItemIds: LocalIdSource;
  appServer: ChatAppServerGateway;
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
  reconnect: () => Promise<void>;
  runtimeProjection: ChatPanelRuntimeProjection;
  refreshDiagnostics: () => Promise<void>;
  refreshLiveState: () => void;
  notifyActiveThreadIdentityChanged: () => void;
}

export function createTurnBundle(host: ChatPanelTurnHost, input: ChatPanelTurnInput): ChatPanelTurnBundle {
  const {
    localItemIds,
    appServer,
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
    reconnect,
    runtimeProjection,
    refreshDiagnostics,
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
  const threadReferenceResolver = appServer.threadReferences({
    prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
  });
  const turnActions = createConversationTurnActions(
    {
      stateStore: host.stateStore,
      localItemIds,
      connectionAvailable: () => appServer.connectionAvailable(),
      turnTransport: appServer.turn,
      referThread: (thread, message, snapshot) => threadReferenceResolver.referThread(thread, message, snapshot),
      status,
      runtime: {
        connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
        modelStatusLines: runtimeProjection.modelStatusLines,
        effortStatusLines: runtimeProjection.effortStatusLines,
        statusSummaryLines: runtimeProjection.statusSummaryLines,
        permissionDetails: runtimeProjection.permissionDetails,
        toolInventoryDetails: async () => {
          if (host.stateStore.getState().connection.serverDiagnostics.toolInventory) {
            return runtimeProjection.toolInventoryDetails();
          }
          await refreshDiagnostics();
          return runtimeProjection.toolInventoryDetails();
        },
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
        prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
        captureInputSnapshot: () => composerController.captureInputSnapshot(),
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: (text, options) => {
          composerController.setDraft(text, options);
        },
      },
      scroll: {
        showLatest: () => {
          host.messageScrollBinding.showLatest();
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
    turnActions,
  };
}

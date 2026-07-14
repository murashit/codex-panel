import type { ChatInboundHandler } from "../../app-server/inbound/handler";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { LocalIdSource } from "../../application/local-id-source";
import { createPendingRequestActions, type PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ThreadStartActions } from "../../application/threads/thread-start-actions";
import { type TurnWorkflowActions as ChatPanelTurnWorkflowActions, createTurnWorkflowActions } from "../../application/turns/composition";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ChatComposerController } from "../../panel/composer-controller";
import type { ChatPanelRuntimeProjection } from "../../panel/runtime-status-projection";
import type { ChatPanelEnvironment } from "../contracts";
import { createWebContextReader } from "../obsidian/web-context.obsidian";
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
  addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
}

interface ChatPanelTurnHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: {
    showLatest(): void;
  };
}

export interface ChatPanelTurnBundle {
  pendingRequests: PendingRequestActions;
  turnActions: ChatPanelTurnWorkflowActions;
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
  threadStart: ThreadStartActions;
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
    threadStart,
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
  const turnActions = createTurnWorkflowActions(
    {
      stateStore: host.stateStore,
      localItemIds,
      connectionAvailable: () => appServer.connectionAvailable(),
      turnTransport: appServer.turn,
      referThread: (thread, message, snapshot) => threadReferenceResolver.referThread(thread, message, snapshot),
      readWebUrl: (url, message, snapshot, isCurrent) =>
        createWebContextReader({
          prepareInput: (text, inputSnapshot) => composerController.preparedInput(text, inputSnapshot),
          viewWindow: host.environment.view.viewWindow,
          ...(isCurrent ? { isCurrent } : {}),
        }).readUrl(url, message, snapshot),
      status,
      runtime: {
        connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
        modelStatusDetails: runtimeProjection.modelStatusDetails,
        effortStatusDetails: runtimeProjection.effortStatusDetails,
        statusDetails: runtimeProjection.statusDetails,
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
        openSideChat: async (threadId) => {
          const source = host.stateStore.getState().threadList.listedThreads.find((thread) => thread.id === threadId);
          await host.environment.plugin.workspace.openSideChat(threadId, source?.name ?? source?.preview ?? null);
        },
      },
      composer: {
        prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
        captureInputSnapshot: () => composerController.captureInputSnapshot(),
        draft: () => composerController.draft,
        trimmedDraft: () => composerController.trimmedDraft,
        setDraft: (text, options) => {
          composerController.setDraft(text, options);
        },
      },
      scroll: {
        showLatest: () => {
          host.threadStreamScrollBinding.showLatest();
        },
      },
    },
    {
      threadStarter: threadStart,
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

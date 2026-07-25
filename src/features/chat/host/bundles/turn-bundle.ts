import type { ChatInboundHandler } from "../../app-server/inbound/handler";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { ReconnectPanelOptions } from "../../application/connection/reconnect-command";
import type { LocalIdSource } from "../../application/local-id-source";
import { createPendingRequestActions, type PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import type { ChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ThreadStartCommand } from "../../application/threads/thread-start-command";
import {
  type TurnWorkflowCommands as ChatPanelTurnWorkflowCommands,
  createTurnWorkflowCommands,
} from "../../application/turns/composition";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ChatComposerController } from "../../panel/composer/controller";
import type { ChatPanelRuntimeNotices } from "../../panel/runtime/notices";
import type { ChatPanelEnvironment } from "../contracts";
import { readWebUrl } from "../obsidian/web-context.obsidian";
import type {
  ChatPanelGoalCommands,
  ChatPanelThreadCommands,
  ChatPanelThreadLifecycle,
  ChatPanelThreadNavigationCommands,
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
  turnCommands: ChatPanelTurnWorkflowCommands;
}

interface ChatPanelTurnInput {
  localItemIds: LocalIdSource;
  appServer: ChatAppServerGateway;
  status: ChatPanelTurnStatus;
  inboundHandler: ChatInboundHandler;
  threadLifecycle: ChatPanelThreadLifecycle;
  threadCommands: ChatPanelThreadCommands;
  navigation: ChatPanelThreadNavigationCommands;
  composerController: ChatComposerController;
  runtimeSettings: ChatRuntimeSettingsCommands;
  threadStart: ThreadStartCommand;
  goals: ChatPanelGoalCommands;
  autoTitleCoordinator: AutoTitleCoordinator;
  reconnect: (options?: ReconnectPanelOptions) => Promise<void>;
  runtimeProjection: ChatPanelRuntimeNotices;
  refreshDiagnostics: () => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
}

export function createTurnBundle(host: ChatPanelTurnHost, input: ChatPanelTurnInput): ChatPanelTurnBundle {
  const {
    localItemIds,
    appServer,
    status,
    inboundHandler,
    threadLifecycle,
    threadCommands,
    navigation,
    composerController,
    runtimeSettings,
    threadStart,
    goals,
    autoTitleCoordinator,
    reconnect,
    runtimeProjection,
    refreshDiagnostics,
    notifyActiveThreadIdentityChanged,
  } = input;
  const pendingRequests = createPendingRequestActions({
    stateStore: host.stateStore,
    responder: inboundHandler,
    composerHasFocus: () => composerController.hasFocus(),
    focusComposer: () => {
      composerController.focusComposer();
    },
  });
  const referThread = appServer.threadReferences({
    prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
  });
  const turnCommands = createTurnWorkflowCommands(
    {
      stateStore: host.stateStore,
      localItemIds,
      connectionAvailable: () => appServer.connectionAvailable(),
      sharedResources: host.environment.plugin.appServerQueries,
      listedThreads: () => host.environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [],
      turnPort: appServer.turn,
      referThread,
      readWebUrl: (url, message, snapshot, isCurrent) =>
        readWebUrl(
          {
            prepareInput: (text, inputSnapshot) => composerController.preparedInput(text, inputSnapshot),
            viewWindow: host.environment.view.viewWindow,
            ...(isCurrent ? { isCurrent } : {}),
          },
          url,
          message,
          snapshot,
        ),
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
          try {
            await refreshDiagnostics();
          } catch (error) {
            if (!host.stateStore.getState().connection.serverDiagnostics.toolInventory) throw error;
          }
          return runtimeProjection.toolInventoryDetails();
        },
      },
      thread: {
        ensureRestoredThreadLoaded: () =>
          threadLifecycle.restoration.ensureLoaded(async (threadId) => {
            await threadLifecycle.resume.resumeThread(threadId);
          }),
        startNewThread: () => navigation.startNewThread(),
        selectThread: (threadId) => navigation.selectThread(threadId),
        notifyIdentityChanged: notifyActiveThreadIdentityChanged,
        resetTurnPresence: (hadTurns) => {
          autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
        },
        openSideChat: async (threadId) => {
          const source = host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((thread) => thread.id === threadId);
          await host.environment.plugin.workspace.openSideChat(threadId, source?.name ?? source?.preview ?? null);
        },
      },
      composer: {
        prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
        captureInputSnapshot: () => composerController.captureInputSnapshot(),
        claimSubmission: () => composerController.claimSubmission(),
        isSubmissionPreparing: () => composerController.isSubmissionPreparing(),
        failActiveSubmissionClaim: () => {
          composerController.failActiveSubmissionClaim();
        },
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
      threadStartCommand: threadStart,
      runtimeSettings,
      threadCommands,
      reconnectCommand: reconnect,
      goals,
    },
  );

  return {
    pendingRequests,
    turnCommands,
  };
}

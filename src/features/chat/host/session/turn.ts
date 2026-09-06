import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { ChatInboundHandler } from "../../app-server/inbound/handler";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { ReconnectPanelOptions } from "../../application/connection/reconnect-command";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import { activeThreadId } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { createSubmissionCommands, type SubmissionCommands as SessionSubmissionCommands } from "../../application/submission/commands";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { GoalCommands } from "../../application/threads/goal-commands";
import type { ThreadCommands } from "../../application/threads/thread-commands";
import type { ThreadNavigationCommands } from "../../application/threads/thread-navigation-commands";
import type { ThreadStartCommand } from "../../application/threads/thread-start-command";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ChatComposerController } from "../composer/controller";
import type { ChatPanelEnvironment } from "../contracts";
import { readWebUrl } from "../obsidian/web-context.obsidian";
import type { ChatPanelRuntimeNotices } from "../runtime/notices";
import { createPendingRequestActions, type PendingRequestActions } from "../thread-stream/pending-request-actions";
import type { SessionThreadLifecycle } from "./thread";

interface SessionTurnStatus {
  set: (statusText: string) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
}

interface SessionTurnHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: {
    showLatest(): void;
  };
}

export interface SessionTurn {
  pendingRequests: PendingRequestActions;
  submissionCommands: SessionSubmissionCommands;
}

interface SessionTurnInput {
  localItemIds: LocalIdSource;
  appServer: ChatAppServerGateway;
  ensureConnected: () => Promise<boolean>;
  status: SessionTurnStatus;
  inboundHandler: ChatInboundHandler;
  threadLifecycle: SessionThreadLifecycle;
  threadCommands: ThreadCommands;
  navigation: ThreadNavigationCommands;
  composerController: ChatComposerController;
  runtimeSettings: ChatRuntimeSettingsCommands;
  threadStart: ThreadStartCommand;
  goals: GoalCommands;
  autoTitleCoordinator: AutoTitleCoordinator;
  reconnect: (options?: ReconnectPanelOptions) => Promise<void>;
  runtimeProjection: ChatPanelRuntimeNotices;
  sharedResources: ChatRuntimeSharedResources & {
    toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
    ensureToolInventory(threadId: string | null): Promise<ToolInventorySnapshot>;
  };
  notifyActiveThreadIdentityChanged: () => void;
}

export function createSessionTurn(host: SessionTurnHost, input: SessionTurnInput): SessionTurn {
  const {
    localItemIds,
    appServer,
    ensureConnected,
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
    sharedResources,
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
    setStatus: status.set,
  });
  const submissionCommands = createSubmissionCommands(
    {
      stateStore: host.stateStore,
      localItemIds,
      connectionAvailable: () => appServer.connectionAvailable(),
      ensureConnected,
      sharedResources,
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
          const threadId = activeThreadId(host.stateStore.getState());
          await sharedResources.ensureToolInventory(threadId);
          return runtimeProjection.toolInventoryDetails();
        },
      },
      thread: {
        ensureRestoredThreadLoaded: threadLifecycle.ensureRestoredThreadLoaded,
        startNewThread: () => navigation.startNewThread(),
        selectThread: (threadId) => navigation.selectThread(threadId),
        notifyIdentityChanged: notifyActiveThreadIdentityChanged,
        resetTurnPresence: (hadTurns) => {
          autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
        },
        openSideChat: async (threadId, message) => {
          const source = host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((thread) => thread.id === threadId);
          await host.environment.plugin.workspace.openSideChat(threadId, source?.name ?? source?.preview ?? null, message);
        },
      },
      composer: {
        prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
        claimSubmission: () => composerController.claimSubmission(),
        isSubmissionPreparing: () => composerController.isSubmissionPreparing(),
        failActiveSubmissionClaim: () => {
          composerController.failActiveSubmissionClaim();
        },
        draft: () => composerController.draft,
        trimmedDraft: () => composerController.trimmedDraft,
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
    submissionCommands,
  };
}

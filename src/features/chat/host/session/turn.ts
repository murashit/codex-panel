import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { ChatInboundHandler } from "../../app-server/inbound/handler";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { ReconnectPanelOptions } from "../../application/connection/reconnect-command";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import { executePanelSlashCommand, type PanelSlashCommandHost } from "../../application/slash-commands/execute-with-state";
import { activeThreadId } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { type ComposerSubmitCommandHost, submitComposer } from "../../application/submission/composer-submit-command";
import { implementPlan, type PlanImplementationHost } from "../../application/submission/plan-implementation";
import { createTurnSubmissionCommand, type TurnSubmissionRequest } from "../../application/submission/turn-submission-command";
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
  submissionCommands: {
    sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
    planImplementation: { implement(itemId: string): Promise<void> };
    composerSubmit: { submit(): Promise<void> };
  };
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
  const turnSubmissionCommand = createTurnSubmissionCommand({
    stateStore: host.stateStore,
    localItemIds,
    turnPort: appServer.turn,
    ensureConnected,
    ensureRestoredThreadLoaded: threadLifecycle.ensureRestoredThreadLoaded,
    startThread: threadStart.startThread,
    notifyActiveThreadIdentityChanged,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
    applyPendingThreadSettings: () => runtimeSettings.applyPendingThreadSettings(),
    prepareInput: (text, snapshot) => composerController.preparedInput(text, snapshot),
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommandHost: PanelSlashCommandHost = {
    stateStore: host.stateStore,
    connectionAvailable: () => appServer.connectionAvailable(),
    sharedResources,
    listedThreads: () => host.environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [],
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
    startNewThread: () => navigation.startNewThread(),
    resumeThread: (threadId) => navigation.selectThread(threadId),
    threadCommands,
    reconnect,
    openSideChat: async (threadId, message) => {
      const source = host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((thread) => thread.id === threadId);
      await host.environment.plugin.workspace.openSideChat(threadId, source?.name ?? source?.preview ?? null, message);
    },
    runtimeSettings,
    goals,
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    statusDetails: runtimeProjection.statusDetails,
    permissionDetails: runtimeProjection.permissionDetails,
    connectionDiagnosticDetails: runtimeProjection.connectionDiagnosticDetails,
    toolInventoryDetails: async () => {
      const threadId = activeThreadId(host.stateStore.getState());
      await sharedResources.ensureToolInventory(threadId);
      return runtimeProjection.toolInventoryDetails();
    },
    modelStatusDetails: runtimeProjection.modelStatusDetails,
    effortStatusDetails: runtimeProjection.effortStatusDetails,
  };
  const planImplementationHost: PlanImplementationHost = {
    stateStore: host.stateStore,
    ensureConnected,
    sendTurnText: async (text) => {
      await turnSubmissionCommand.sendTurnText({ text });
    },
    requestDefaultCollaborationModeForNextTurn: () => {
      runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  };
  const composerSubmitHost: ComposerSubmitCommandHost = {
    stateStore: host.stateStore,
    localItemIds,
    ensureRestoredThreadLoaded: threadLifecycle.ensureRestoredThreadLoaded,
    composer: composerController,
    slashCommandExecutor: {
      execute: (command, args, inputSnapshot, submission) =>
        executePanelSlashCommand(slashCommandHost, command, args, inputSnapshot, submission),
    },
    turnSubmissionCommand,
    connection: { ensureConnected },
    turnPort: appServer.turn,
    status: { setStatus: status.set, addSystemMessage: status.addSystemMessage },
    scroll: host.threadStreamScrollBinding,
  };
  return {
    pendingRequests,
    submissionCommands: {
      sendTurnText: (request) => turnSubmissionCommand.sendTurnText(request),
      planImplementation: { implement: (itemId) => implementPlan(planImplementationHost, itemId) },
      composerSubmit: { submit: () => submitComposer(composerSubmitHost) },
    },
  };
}

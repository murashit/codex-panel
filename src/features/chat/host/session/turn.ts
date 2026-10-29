import { Notice } from "obsidian";
import { readLatestThreadTurnId } from "../../../../app-server/services/threads";
import { codexTextInput } from "../../../../domain/input/input";
import type { ToolInventorySnapshot } from "../../../../domain/runtime/tool-inventory";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { ComposerInput } from "../../application/composer/input";
import type { NoteCandidateProvider } from "../../application/composer/note-context";
import type { ReconnectPanelOptions } from "../../application/connection/reconnect-command";
import type { LocalIdSource } from "../../application/local-id-source";
import type { PendingRequests } from "../../application/pending-requests/controller";
import type { ChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import { executePanelSlashCommand, type PanelSlashCommandHost } from "../../application/slash-commands/execute-with-state";
import { activeThreadId } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { type ComposerSubmitCommandHost, submitComposer } from "../../application/submission/composer-submit-command";
import { implementPlan, type PlanImplementationHost } from "../../application/submission/plan-implementation";
import { createTurnSubmissionCommand, type TurnSubmissionRequest } from "../../application/submission/turn-submission-command";
import { sideChatDraft } from "../../application/threads/fork-draft";
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
  pendingRequests: PendingRequests;
  threadLifecycle: SessionThreadLifecycle;
  threadCommands: ThreadCommands;
  navigation: ThreadNavigationCommands;
  composerInput: ComposerInput;
  composerController: Pick<ChatComposerController, "hasFocus" | "focusComposer">;
  resolveFileReference: NoteCandidateProvider["resolveFileReference"];
  runtimeSettings: ChatRuntimeSettingsCommands;
  threadStart: ThreadStartCommand;
  goals: GoalCommands;
  reconnect: (options?: ReconnectPanelOptions) => Promise<void>;
  runtimeProjection: ChatPanelRuntimeNotices;
  sharedResources: ChatRuntimeSharedResources & {
    toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
    ensureToolInventory(threadId: string | null): Promise<ToolInventorySnapshot>;
  };
}

export function createSessionTurn(host: SessionTurnHost, input: SessionTurnInput): SessionTurn {
  const {
    localItemIds,
    appServer,
    ensureConnected,
    status,
    pendingRequests: requestController,
    threadLifecycle,
    threadCommands,
    navigation,
    composerInput,
    composerController,
    resolveFileReference,
    runtimeSettings,
    threadStart,
    goals,
    reconnect,
    runtimeProjection,
    sharedResources,
  } = input;
  const pendingRequests = createPendingRequestActions({
    stateStore: host.stateStore,
    requests: requestController,
    composerHasFocus: () => composerController.hasFocus(),
    focusComposer: () => {
      composerController.focusComposer();
    },
  });
  const referThread = appServer.threadReferences({
    resolveFileReference,
    setStatus: status.set,
  });
  const turnSubmissionCommand = createTurnSubmissionCommand({
    forkReplacement: {
      beginPublication: (sourceThreadId) => host.environment.plugin.threadReplacementPublication.begin(sourceThreadId),
      latestTurnId: (sourceThreadId) =>
        host.environment.plugin.appServerConnection.withClient((client) => readLatestThreadTurnId(client, sourceThreadId)),
      archiveSource: async (sourceThreadId, saveMarkdown) => {
        const result = await host.environment.plugin.threadMutations.archiveThread(sourceThreadId, { saveMarkdown });
        if (result.exportedPath) new Notice(`Saved thread to ${result.exportedPath}.`);
        return result.kind === "archived";
      },
      notify: (message) => {
        new Notice(message);
      },
    },
    stateStore: host.stateStore,
    localItemIds,
    turnPort: appServer.turn,
    ensureConnected,
    ensureRestoredThreadLoaded: threadLifecycle.ensureRestoredThreadLoaded,
    startThread: threadStart.startThread,
    applyPendingThreadSettings: () => runtimeSettings.applyPendingThreadSettings(),
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommandHost: PanelSlashCommandHost = {
    stateStore: host.stateStore,
    connectionAvailable: () => appServer.connectionAvailable(),
    listedThreads: () => host.environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [],
    referThread,
    readWebUrl: (url, message, snapshot, isCurrent) =>
      readWebUrl(
        {
          resolveFileReference,
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
      await host.environment.plugin.workspace.openForkDraft(
        sideChatDraft(threadId, source?.name ?? source?.preview ?? null, host.stateStore.getState().runtime),
        message,
      );
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
    claimSubmission: (text) => composerInput.claimTextSubmission(text, { restoreOnFailure: false }),
    sendTurnText: async (claim) => {
      await turnSubmissionCommand.sendTurnText({
        preparedInput: { text: claim.text, input: codexTextInput(claim.text) },
        submissionClaim: claim,
      });
    },
    requestDefaultCollaborationModeForNextTurn: () => {
      runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  };
  const composerSubmitHost: ComposerSubmitCommandHost = {
    stateStore: host.stateStore,
    localItemIds,
    ensureRestoredThreadLoaded: threadLifecycle.ensureRestoredThreadLoaded,
    composer: composerInput,
    resolveFileReference,
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

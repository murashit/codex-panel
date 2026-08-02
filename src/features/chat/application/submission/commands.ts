import type { Thread } from "../../../../domain/threads/model";
import type { CodexInput } from "../../../../domain/turns/input";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionAdoption, ComposerSubmissionClaim } from "../composer/submission-claim";
import type { ReconnectPanelOptions } from "../connection/reconnect-command";
import type { LocalIdSource } from "../local-id-source";
import type { ChatRuntimeSettingsCommands } from "../runtime/settings-commands";
import type { ChatRuntimeSharedResources } from "../runtime/snapshot";
import type { ThreadReferenceInput, WebUrlInput } from "../slash-commands/execute";
import { executePanelSlashCommand, type PanelSlashCommandHost } from "../slash-commands/execute-with-state";
import type { ChatStateStore } from "../state/store";
import type { GoalCommands } from "../threads/goal-commands";
import type { ThreadCommands } from "../threads/thread-commands";
import type { ThreadStartOutcome } from "../threads/thread-start-command";
import type { ChatTurnPort } from "../turns/turn-port";
import { type ComposerSubmitCommand, type ComposerSubmitCommandHost, submitComposer } from "./composer-submit-command";
import { implementPlan, type PlanImplementationHost } from "./plan-implementation";
import { createTurnSubmissionCommand, type TurnSubmissionRequest } from "./turn-submission-command";

export interface SubmissionCommandsContext {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  connectionAvailable: () => boolean;
  sharedResources: ChatRuntimeSharedResources;
  listedThreads: () => readonly Thread[];
  turnPort: ChatTurnPort;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<ThreadReferenceInput | null>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<WebUrlInput>;
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
  };
  runtime: {
    connectionDiagnosticDetails: () => ThreadStreamNoticeSection[];
    permissionDetails: () => ThreadStreamNoticeSection[];
    modelStatusDetails: () => ThreadStreamNoticeSection[];
    effortStatusDetails: () => ThreadStreamNoticeSection[];
    statusDetails: () => ThreadStreamNoticeSection[];
    toolInventoryDetails: () => ThreadStreamNoticeSection[] | Promise<ThreadStreamNoticeSection[]>;
  };
  thread: {
    ensureRestoredThreadLoaded: () => Promise<boolean>;
    startNewThread: () => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    openSideChat?: (threadId: string, message?: string) => Promise<void>;
  };
  composer: {
    prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
    claimSubmission: () => ComposerSubmissionClaim | null;
    isSubmissionPreparing: () => boolean;
    failActiveSubmissionClaim: () => void;
    draft: () => string;
    trimmedDraft: () => string;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface SubmissionCommandsRefs {
  threadStartCommand: SubmissionThreadStarter;
  runtimeSettings: ChatRuntimeSettingsCommands;
  threadCommands: ThreadCommands;
  reconnectCommand: (options?: ReconnectPanelOptions) => Promise<void>;
  goals: GoalCommands;
}

interface SubmissionThreadStarter {
  startThread: (
    preview?: string,
    options?: {
      syncGoal?: boolean;
      preservePendingSubmissionId?: string;
      adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"];
    },
  ) => Promise<ThreadStartOutcome>;
}

interface PlanImplementation {
  implement: (itemId: string) => Promise<void>;
}

export interface SubmissionCommands {
  sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
  planImplementation: PlanImplementation;
  composerSubmit: ComposerSubmitCommand;
}

export function createSubmissionCommands(context: SubmissionCommandsContext, refs: SubmissionCommandsRefs): SubmissionCommands {
  const { stateStore, localItemIds, connectionAvailable, turnPort, referThread, readWebUrl, status, runtime, thread, composer, scroll } =
    context;
  const turnSubmissionCommand = createTurnSubmissionCommand({
    stateStore,
    localItemIds,
    turnPort,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    startThread: (preview, options) => refs.threadStartCommand.startThread(preview, options),
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    resetThreadTurnPresence: thread.resetTurnPresence,
    applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    prepareInput: composer.prepareInput,
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommandExecutorHost: PanelSlashCommandHost = {
    stateStore,
    connectionAvailable,
    sharedResources: context.sharedResources,
    listedThreads: context.listedThreads,
    referThread,
    readWebUrl,
    startNewThread: thread.startNewThread,
    startThreadForGoal: (objective, adoptPanelTarget) => startThreadForGoal(refs.threadStartCommand, objective, adoptPanelTarget),
    resumeThread: thread.selectThread,
    threadCommands: refs.threadCommands,
    reconnect: refs.reconnectCommand,
    ...(thread.openSideChat ? { openSideChat: thread.openSideChat } : {}),
    runtimeSettings: refs.runtimeSettings,
    goals: refs.goals,
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    statusDetails: runtime.statusDetails,
    permissionDetails: runtime.permissionDetails,
    connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
    toolInventoryDetails: runtime.toolInventoryDetails,
    modelStatusDetails: runtime.modelStatusDetails,
    effortStatusDetails: runtime.effortStatusDetails,
  };
  const planImplementationHost: PlanImplementationHost = {
    stateStore,
    ensureConnected: () => turnPort.ensureConnected(),
    sendTurnText: async (text) => {
      await turnSubmissionCommand.sendTurnText({ text });
    },
    requestDefaultCollaborationModeForNextTurn: () => {
      refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  };
  const composerSubmitHost: ComposerSubmitCommandHost = {
    stateStore,
    localItemIds,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    composer: {
      get draft() {
        return composer.draft();
      },
      get trimmedDraft() {
        return composer.trimmedDraft();
      },
      claimSubmission: composer.claimSubmission,
      isSubmissionPreparing: composer.isSubmissionPreparing,
      failActiveSubmissionClaim: composer.failActiveSubmissionClaim,
    },
    slashCommandExecutor: {
      execute: (command, args, inputSnapshot, submission) =>
        executePanelSlashCommand(slashCommandExecutorHost, command, args, inputSnapshot, submission),
    },
    turnSubmissionCommand,
    connection: {
      ensureConnected: () => turnPort.ensureConnected(),
    },
    turnPort,
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
    scroll,
  };

  return {
    sendTurnText: (request) => turnSubmissionCommand.sendTurnText(request),
    planImplementation: {
      implement: (itemId) => implementPlan(planImplementationHost, itemId),
    },
    composerSubmit: {
      submit: () => submitComposer(composerSubmitHost),
    },
  };
}

async function startThreadForGoal(
  starter: SubmissionThreadStarter,
  objective: string,
  adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"],
): Promise<string | null> {
  const outcome = await starter.startThread(objective, {
    syncGoal: false,
    ...(adoptPanelTarget ? { adoptPanelTarget } : {}),
  });
  return outcome.kind === "created-activated" ? outcome.threadId : null;
}

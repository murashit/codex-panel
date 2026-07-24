import type { CodexInput } from "../../../../domain/chat/input";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionClaim } from "../composer/submission-claim";
import type { ReconnectPanelOptions } from "../connection/reconnect-command";
import type { LocalIdSource } from "../local-id-source";
import type { ChatRuntimeSettingsCommands } from "../runtime/settings-commands";
import type { ChatStateStore } from "../state/store";
import type { GoalCommands } from "../threads/goal-commands";
import type { ThreadCommands } from "../threads/thread-commands";
import type { ThreadStartOutcome } from "../threads/thread-start-command";
import { type ComposerSubmitCommand, type ComposerSubmitCommandHost, submitComposer } from "./composer-submit-command";
import { implementPlan, type PlanImplementationHost } from "./plan-implementation";
import type { ThreadReferenceInput, WebUrlInput } from "./slash-command-execution";
import { executeSlashCommandWithState, type SlashCommandExecutorHost } from "./slash-command-executor";
import type { ChatTurnPort } from "./turn-port";
import { createTurnSubmissionCommand } from "./turn-submission-command";

export interface TurnWorkflowContext {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  connectionAvailable: () => boolean;
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
    startNewThread: (options?: { beforeActivate?: () => void }) => Promise<void>;
    selectThread: (threadId: string, options?: { beforeActivate?: () => void }) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    openSideChat?: (threadId: string) => Promise<void>;
  };
  composer: {
    prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
    captureInputSnapshot: () => ComposerInputSnapshot;
    claimSubmission: () => ComposerSubmissionClaim | null;
    isSubmissionPreparing: () => boolean;
    failActiveSubmissionClaim: () => void;
    draft: () => string;
    trimmedDraft: () => string;
    setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean; preserveContext?: boolean }) => void;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface TurnWorkflowRefs {
  threadStartCommand: TurnWorkflowThreadStarter;
  runtimeSettings: ChatRuntimeSettingsCommands;
  threadCommands: ThreadCommands;
  reconnectCommand: (options?: ReconnectPanelOptions) => Promise<void>;
  goals: GoalCommands;
}

interface TurnWorkflowThreadStarter {
  startThread: (
    preview?: string,
    options?: { syncGoal?: boolean; preservePendingSubmissionId?: string; beforeActivate?: () => void },
  ) => Promise<ThreadStartOutcome>;
}

interface PlanImplementation {
  implement: (itemId: string) => Promise<void>;
}

export interface TurnWorkflowCommands {
  planImplementation: PlanImplementation;
  composerSubmit: ComposerSubmitCommand;
}

export function createTurnWorkflowCommands(context: TurnWorkflowContext, refs: TurnWorkflowRefs): TurnWorkflowCommands {
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
  const slashCommandExecutorHost: SlashCommandExecutorHost = {
    stateStore,
    connectionAvailable,
    referThread,
    readWebUrl,
    startNewThread: thread.startNewThread,
    startThreadForGoal: (objective, options) =>
      startThreadForGoal(refs.threadStartCommand, objective, status.addSystemMessage, options?.beforeActivate),
    resumeThread: thread.selectThread,
    threadCommands: refs.threadCommands,
    reconnect: refs.reconnectCommand,
    ...(thread.openSideChat ? { openSideChat: thread.openSideChat } : {}),
    runtimeSettings: refs.runtimeSettings,
    goals: refs.goals,
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    setStatus: status.set,
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
        executeSlashCommandWithState(slashCommandExecutorHost, command, args, inputSnapshot, submission),
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
    planImplementation: {
      implement: (itemId) => implementPlan(planImplementationHost, itemId),
    },
    composerSubmit: {
      submit: () => submitComposer(composerSubmitHost),
    },
  };
}

async function startThreadForGoal(
  starter: TurnWorkflowThreadStarter,
  objective: string,
  addSystemMessage: (message: string) => void,
  beforeActivate?: () => void,
): Promise<string | null> {
  const outcome = await starter.startThread(objective, {
    syncGoal: false,
    ...(beforeActivate ? { beforeActivate } : {}),
  });
  if (outcome.kind === "created-not-activated") {
    addSystemMessage(
      `Created thread ${outcome.threadId}, but the connection changed before it could be opened. Resume it from history before setting its goal.`,
    );
    return null;
  }
  return outcome.kind === "created-activated" ? outcome.threadId : null;
}

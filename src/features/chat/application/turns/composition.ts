import type { CodexInput } from "../../../../domain/chat/input";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { LocalIdSource } from "../local-id-source";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { ChatStateStore } from "../state/store";
import type { GoalActions } from "../threads/goal-actions";
import type { ThreadCommands } from "../threads/thread-commands";
import type { ThreadStartOutcome } from "../threads/thread-start-actions";
import { type ComposerSubmitActions, type ComposerSubmitActionsHost, submitComposer } from "./composer-submit-actions";
import { implementPlan, type PlanImplementationHost } from "./plan-implementation";
import type { ThreadReferenceInput, WebUrlInput } from "./slash-command-execution";
import { executeSlashCommandWithState, type SlashCommandExecutorHost } from "./slash-command-executor";
import type { ChatTurnPort } from "./turn-port";
import { createTurnSubmissionActions } from "./turn-submission-actions";

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
    startNewThread: () => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    openSideChat?: (threadId: string) => Promise<void>;
  };
  composer: {
    prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
    captureInputSnapshot: () => ComposerInputSnapshot;
    draft: () => string;
    trimmedDraft: () => string;
    setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean; preserveContext?: boolean }) => void;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface TurnWorkflowRefs {
  threadStarter: TurnWorkflowThreadStarter;
  runtimeSettings: ChatRuntimeSettingsActions;
  threadActions: ThreadCommands;
  reconnectPanel: () => Promise<void>;
  goals: GoalActions;
}

interface TurnWorkflowThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean; preservePendingSubmissionId?: string }) => Promise<ThreadStartOutcome>;
}

interface PlanImplementation {
  implement: (itemId: string) => Promise<void>;
}

export interface TurnWorkflowActions {
  planImplementation: PlanImplementation;
  composerSubmit: ComposerSubmitActions;
}

export function createTurnWorkflowActions(context: TurnWorkflowContext, refs: TurnWorkflowRefs): TurnWorkflowActions {
  const { stateStore, localItemIds, connectionAvailable, turnPort, referThread, readWebUrl, status, runtime, thread, composer, scroll } =
    context;
  const turnSubmission = createTurnSubmissionActions({
    stateStore,
    localItemIds,
    turnPort,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    startThread: (preview, options) => refs.threadStarter.startThread(preview, options),
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    resetThreadTurnPresence: thread.resetTurnPresence,
    applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    prepareInput: composer.prepareInput,
    setDraft: composer.setDraft,
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommandExecutorHost: SlashCommandExecutorHost = {
    stateStore,
    connectionAvailable,
    referThread,
    readWebUrl,
    startNewThread: thread.startNewThread,
    startThreadForGoal: (objective) => startThreadForGoal(refs.threadStarter, objective, status.addSystemMessage),
    resumeThread: thread.selectThread,
    threadActions: refs.threadActions,
    reconnect: refs.reconnectPanel,
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
      await turnSubmission.sendTurnText({ text });
    },
    requestDefaultCollaborationModeForNextTurn: () => {
      refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  };
  const composerSubmitHost: ComposerSubmitActionsHost = {
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
      setDraft: composer.setDraft,
      captureInputSnapshot: composer.captureInputSnapshot,
    },
    slashCommandExecutor: {
      execute: (command, args, inputSnapshot, isWebImportCurrent) =>
        executeSlashCommandWithState(slashCommandExecutorHost, command, args, inputSnapshot, isWebImportCurrent),
    },
    turnSubmission,
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
): Promise<string | null> {
  const outcome = await starter.startThread(objective, { syncGoal: false });
  if (outcome.kind === "created-not-activated") {
    addSystemMessage(
      `Created thread ${outcome.threadId}, but the connection changed before it could be opened. Resume it from history before setting its goal.`,
    );
    return null;
  }
  return outcome.kind === "created-activated" ? outcome.threadId : null;
}

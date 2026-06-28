import type { CodexInput } from "../../../../domain/chat/input";
import type { Thread } from "../../../../domain/threads/model";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { ChatStateStore } from "../state/store";
import type { GoalActions } from "../threads/goal-actions";
import type { ThreadManagementActions } from "../threads/thread-management-actions";
import { type ComposerSubmitActions, type ComposerSubmitActionsHost, submitComposer } from "./composer-submit-actions";
import { implementPlan, type PlanImplementationHost } from "./plan-implementation";
import type { ThreadReferenceInput } from "./slash-command-execution";
import { executeSlashCommandWithState, type SlashCommandExecutorHost } from "./slash-command-executor";
import { createTurnSubmissionActions } from "./turn-submission-actions";
import type { ChatTurnTransport } from "./turn-transport";

export interface ConversationTurnActionsContext {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  connectionAvailable: () => boolean;
  turnTransport: ChatTurnTransport;
  referThread: (thread: Thread, message: string) => Promise<ThreadReferenceInput | null>;
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
  };
  runtime: {
    connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
    modelStatusLines: () => string[];
    effortStatusLines: () => string[];
    statusSummaryLines: () => string[];
    toolInventoryDetails: () => MessageStreamNoticeSection[] | Promise<MessageStreamNoticeSection[]>;
  };
  thread: {
    ensureRestoredThreadLoaded: () => Promise<boolean>;
    startNewThread: () => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
  };
  composer: {
    codexInput: (text: string) => CodexInput;
    prepareInput: (text: string) => { text: string; input: CodexInput };
    trimmedDraft: () => string;
    setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
    withPreservedComposerReferences: <T>(operation: () => Promise<T>) => Promise<T>;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface ConversationTurnActionsRefs {
  threadStarter: ConversationThreadStarter;
  runtimeSettings: ChatRuntimeSettingsActions;
  threadActions: ThreadManagementActions;
  reconnectPanel: () => Promise<void>;
  goals: GoalActions;
}

interface ConversationThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
}

interface PlanImplementation {
  implement: (itemId: string) => Promise<void>;
}

export interface ConversationTurnActions {
  planImplementation: PlanImplementation;
  composerSubmit: ComposerSubmitActions;
}

export function createConversationTurnActions(
  context: ConversationTurnActionsContext,
  refs: ConversationTurnActionsRefs,
): ConversationTurnActions {
  const { stateStore, localItemIds, connectionAvailable, turnTransport, referThread, status, runtime, thread, composer, scroll } = context;
  const turnSubmission = createTurnSubmissionActions({
    stateStore,
    localItemIds,
    turnTransport,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    startThread: async (preview) => (await refs.threadStarter.startThread(preview)) !== null,
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
    startNewThread: thread.startNewThread,
    startThreadForGoal: (objective) => startThreadForGoal(refs.threadStarter, objective),
    resumeThread: thread.selectThread,
    threadActions: refs.threadActions,
    reconnect: refs.reconnectPanel,
    runtimeSettings: refs.runtimeSettings,
    goals: refs.goals,
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    setStatus: status.set,
    statusSummaryLines: runtime.statusSummaryLines,
    connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
    toolInventoryDetails: runtime.toolInventoryDetails,
    modelStatusLines: runtime.modelStatusLines,
    effortStatusLines: runtime.effortStatusLines,
  };
  const planImplementationHost: PlanImplementationHost = {
    stateStore,
    ensureConnected: () => turnTransport.ensureConnected(),
    sendTurnText: (text) => turnSubmission.sendTurnText(text),
    requestDefaultCollaborationModeForNextTurn: () => {
      refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  };
  const composerSubmitHost: ComposerSubmitActionsHost = {
    stateStore,
    composer: {
      get trimmedDraft() {
        return composer.trimmedDraft();
      },
      setDraft: composer.setDraft,
      withPreservedComposerReferences: composer.withPreservedComposerReferences,
    },
    slashCommandExecutor: {
      execute: (command, args) => executeSlashCommandWithState(slashCommandExecutorHost, command, args),
    },
    turnSubmission,
    connection: {
      ensureConnected: () => turnTransport.ensureConnected(),
    },
    turnTransport,
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

async function startThreadForGoal(starter: ConversationThreadStarter, objective: string): Promise<string | null> {
  const response = await starter.startThread(objective, { syncGoal: false });
  return response?.threadId ?? null;
}

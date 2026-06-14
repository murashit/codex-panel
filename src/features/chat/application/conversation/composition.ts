import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import type { ChatReconnectActions } from "../connection/reconnect-actions";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { ChatStateStore } from "../state/reducer";
import type { ThreadManagementActions } from "../threads/thread-management-actions";
import type { GoalActions } from "../threads/goal-actions";
import { createComposerSubmitActions, type ComposerSubmitActions } from "./composer-submit-actions";
import { createPlanImplementation, type PlanImplementation } from "./plan-implementation";
import { createSlashCommandHandler } from "./slash-command-handler";
import { TurnSubmissionController } from "./turn-submission-controller";

export interface ConversationTurnActionsContext {
  vaultPath: string;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
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
    mcpStatusLines: () => Promise<string[]>;
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
    trimmedDraft: () => string;
    setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
  };
  scroll: {
    followBottom: () => void;
  };
}

export interface ConversationTurnActionsRefs {
  threadStarter: ConversationThreadStarter;
  runtimeSettings: ChatRuntimeSettingsActions;
  threadActions: ThreadManagementActions;
  reconnectActions: ChatReconnectActions;
  goals: GoalActions;
}

export interface ConversationThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
}

export interface ConversationTurnActions {
  planImplementation: PlanImplementation;
  composerSubmit: ComposerSubmitActions;
}

export function createConversationTurnActions(
  context: ConversationTurnActionsContext,
  refs: ConversationTurnActionsRefs,
): ConversationTurnActions {
  const { vaultPath, stateStore, client, status, runtime, thread, composer, scroll } = context;
  const turnSubmission = new TurnSubmissionController({
    stateStore,
    vaultPath,
    currentClient: client.currentClient,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    startThread: (preview) => refs.threadStarter.startThread(preview),
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    resetThreadTurnPresence: thread.resetTurnPresence,
    applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    codexInput: composer.codexInput,
    setDraft: composer.setDraft,
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommands = createSlashCommandHandler({
    stateStore,
    currentClient: client.currentClient,
    codexInput: composer.codexInput,
    startNewThread: thread.startNewThread,
    startThreadForGoal: (objective) => startThreadForGoal(refs.threadStarter, objective),
    resumeThread: thread.selectThread,
    forkThread: (threadId) => refs.threadActions.forkThread(threadId),
    rollbackThread: (threadId) => refs.threadActions.rollbackThread(threadId),
    compactThread: (threadId) => refs.threadActions.compactThread(threadId),
    archiveThread: (threadId, saveMarkdown) => refs.threadActions.archiveThread(threadId, saveMarkdown),
    renameThread: (threadId, name) => refs.threadActions.renameThread(threadId, name).then(() => undefined),
    reconnect: () => refs.reconnectActions.reconnectPanel(),
    toggleFastMode: () => refs.runtimeSettings.toggleFastMode(),
    toggleCollaborationMode: () => refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    requestModel: (model) => refs.runtimeSettings.requestModel(model),
    resetModelToConfig: () => refs.runtimeSettings.resetModelToConfig(),
    requestReasoningEffort: (effort) => refs.runtimeSettings.requestReasoningEffort(effort),
    resetReasoningEffortToConfig: () => refs.runtimeSettings.resetReasoningEffortToConfig(),
    activeGoal: () => refs.goals.activeGoal(),
    setGoalObjective: (threadId, objective, tokenBudget) => refs.goals.setObjective(threadId, objective, tokenBudget),
    setGoalStatus: (threadId, goalStatus) => refs.goals.setStatus(threadId, goalStatus),
    clearGoal: (threadId) => refs.goals.clear(threadId),
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    setStatus: status.set,
    statusSummaryLines: runtime.statusSummaryLines,
    connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
    mcpStatusLines: runtime.mcpStatusLines,
    modelStatusLines: runtime.modelStatusLines,
    effortStatusLines: runtime.effortStatusLines,
  });
  const planImplementation = createPlanImplementation({
    stateStore,
    currentClient: client.currentClient,
    ensureConnected: client.ensureConnected,
    sendTurnText: (text) => turnSubmission.sendTurnText(text),
    requestDefaultCollaborationModeForNextTurn: () => {
      refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  });
  const composerSubmit = createComposerSubmitActions({
    stateStore,
    composer: {
      get trimmedDraft() {
        return composer.trimmedDraft();
      },
      setDraft: composer.setDraft,
    },
    slashCommands,
    turnSubmission,
    connection: {
      currentClient: client.currentClient,
      ensureConnected: client.ensureConnected,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
    scroll,
  });

  return {
    planImplementation,
    composerSubmit,
  };
}

async function startThreadForGoal(actions: ConversationThreadStarter, objective: string): Promise<string | null> {
  const response = await actions.startThread(objective, { syncGoal: false });
  return response?.threadId ?? null;
}

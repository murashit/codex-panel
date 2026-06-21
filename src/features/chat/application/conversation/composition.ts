import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import { activeThreadId, canImplementPlanItemId } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import type { ThreadManagementActions } from "../threads/thread-management-actions";
import type { GoalActions } from "../threads/goal-actions";
import { submitComposer, type ComposerSubmitActions, type ComposerSubmitActionsHost } from "./composer-submit-actions";
import { executeSlashCommandWithState, type SlashCommandExecutorHost } from "./slash-command-executor";
import { createTurnSubmissionActions } from "./turn-submission-actions";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface ConversationTurnActionsContext {
  vaultPath: string;
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  client: {
    currentClient: () => AppServerClient | null;
    connectedClient: () => Promise<AppServerClient | null>;
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
    toolInventoryDetails: () => MessageStreamNoticeSection[];
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
  reconnectPanel: () => Promise<void>;
  goals: GoalActions;
}

interface ConversationThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
}

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  connectedClient(): Promise<AppServerClient | null>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
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
  const { vaultPath, stateStore, localItemIds, client, status, runtime, thread, composer, scroll } = context;
  const turnSubmission = createTurnSubmissionActions({
    stateStore,
    vaultPath,
    localItemIds,
    connectedClient: client.connectedClient,
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
  const slashCommandExecutorHost: SlashCommandExecutorHost = {
    stateStore,
    currentClient: client.currentClient,
    codexInput: composer.codexInput,
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
    connectedClient: client.connectedClient,
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
    },
    slashCommandExecutor: {
      execute: (command, args) => executeSlashCommandWithState(slashCommandExecutorHost, command, args),
    },
    turnSubmission,
    connection: {
      connectedClient: client.connectedClient,
      currentClient: client.currentClient,
    },
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

export async function implementPlan(host: PlanImplementationHost, itemId: string): Promise<void> {
  if (!canImplementPlanItemId(host.stateStore.getState(), itemId)) return;
  if (!(await host.connectedClient()) || !activeThreadId(host.stateStore.getState())) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

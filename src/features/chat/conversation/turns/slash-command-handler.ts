import type { AppServerClient } from "../../../../app-server/connection/client";
import { codexTextInputWithAttachments, type CodexInput } from "../../../../app-server/protocol/request-input";
import { chronologicalConversationSummariesFromTurnRecords } from "../../../../app-server/protocol/turn";
import { referencedThreadPromptBundle, referencedThreadTurns, REFERENCED_THREAD_TURN_LIMIT } from "../../../../domain/threads/reference";
import type { Thread } from "../../../../domain/threads/model";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandExecutionResult,
  type ThreadReferenceInput,
} from "./slash-command-execution";
import type { SlashCommandName } from "../composer/slash-commands";
import type { DisplayDetailSection } from "../../display/types";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import type { ThreadGoal, ThreadGoalStatus } from "../../../../app-server/protocol/thread-goal";
import { submissionStateSnapshot } from "../../state/selectors";
import type { ChatStateStore } from "../../state/reducer";
import { currentModel, runtimeConfigOrDefault } from "../../runtime/effective";
import { runtimeSnapshotForChatState } from "../../runtime/snapshot";

export interface SlashCommandThreadPort {
  startNewThread: () => Promise<void>;
  startThreadForGoal: (objective: string) => Promise<string | null>;
  resumeThread: (threadId: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<void>;
  reconnect: () => Promise<void>;
}

export interface SlashCommandRuntimePort {
  toggleFastMode: () => void | Promise<void>;
  toggleCollaborationMode: () => void | Promise<void>;
  toggleAutoReview: () => void | Promise<void>;
  requestModel: (model: string) => boolean | undefined | Promise<boolean | undefined>;
  resetModelToConfig: () => boolean | undefined | Promise<boolean | undefined>;
  requestReasoningEffort: (effort: ReasoningEffort) => boolean | undefined | Promise<boolean | undefined>;
  resetReasoningEffortToConfig: () => boolean | undefined | Promise<boolean | undefined>;
}

export interface SlashCommandStatusPort {
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  setStatus: (status: string) => void;
  statusSummaryLines: () => string[];
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandGoalPort {
  activeGoal: () => ThreadGoal | null;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
}

export interface SlashCommandHandlerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  codexInput: (text: string) => CodexInput;
  threads: SlashCommandThreadPort;
  runtime: SlashCommandRuntimePort;
  goals: SlashCommandGoalPort;
  status: SlashCommandStatusPort;
}

export interface SlashCommandHandler {
  execute: (command: SlashCommandName, args: string) => Promise<SlashCommandExecutionResult | undefined>;
}

export function createSlashCommandHandler(host: SlashCommandHandlerHost): SlashCommandHandler {
  return {
    execute: (command, args) => executeSlashCommand(host, command, args),
  };
}

async function executeSlashCommand(
  host: SlashCommandHandlerHost,
  command: SlashCommandName,
  args: string,
): Promise<SlashCommandExecutionResult | undefined> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const client = host.currentClient();
  if (!client && command !== "reconnect" && command !== "compact") return;
  return runSlashCommand(command, args, {
    activeThreadId: state.activeThreadId,
    listedThreads: state.listedThreads,
    startNewThread: () => host.threads.startNewThread(),
    startThreadForGoal: (objective) => host.threads.startThreadForGoal(objective),
    resumeThread: (threadId) => host.threads.resumeThread(threadId),
    reconnect: () => host.threads.reconnect(),
    referThread: (thread, message) => {
      if (!client) return Promise.resolve(null);
      return referencedThreadInput(host, client, thread, message);
    },
    forkThread: (threadId) => host.threads.forkThread(threadId),
    rollbackThread: (threadId) => host.threads.rollbackThread(threadId),
    compactThread: (threadId) => host.threads.compactThread(threadId),
    archiveThread: (threadId) => host.threads.archiveThread(threadId),
    renameThread: (threadId, name) => host.threads.renameThread(threadId, name),
    busy: state.busy,
    toggleFastMode: () => host.runtime.toggleFastMode(),
    toggleCollaborationMode: () => host.runtime.toggleCollaborationMode(),
    toggleAutoReview: () => host.runtime.toggleAutoReview(),
    addSystemMessage: (text) => {
      host.status.addSystemMessage(text);
    },
    addStructuredSystemMessage: (text, details) => {
      host.status.addStructuredSystemMessage(text, details);
    },
    requestModel: (model) => host.runtime.requestModel(model),
    resetModelToConfig: () => host.runtime.resetModelToConfig(),
    requestReasoningEffort: (effort) => host.runtime.requestReasoningEffort(effort),
    resetReasoningEffortToConfig: () => host.runtime.resetReasoningEffortToConfig(),
    supportedReasoningEfforts: () => supportedReasoningEfforts(host.stateStore.getState()),
    activeGoal: () => host.goals.activeGoal(),
    setGoalObjective: (threadId, objective, tokenBudget) => host.goals.setObjective(threadId, objective, tokenBudget),
    setGoalStatus: (threadId, status) => host.goals.setStatus(threadId, status),
    clearGoal: (threadId) => host.goals.clear(threadId),
    statusSummaryLines: () => host.status.statusSummaryLines(),
    connectionDiagnosticDetails: () => host.status.connectionDiagnosticDetails(),
    mcpStatusLines: () => host.status.mcpStatusLines(),
    modelStatusLines: () => host.status.modelStatusLines(),
    effortStatusLines: () => host.status.effortStatusLines(),
  });
}

function supportedReasoningEfforts(state: ReturnType<ChatStateStore["getState"]>): ReasoningEffort[] {
  const config = runtimeConfigOrDefault(state.connection.runtimeConfig);
  const model = findModelMetadataByIdOrName(state.connection.availableModels, currentModel(runtimeSnapshotForChatState(state), config));
  return supportedEffortsForModelMetadata(model);
}

async function referencedThreadInput(
  host: SlashCommandHandlerHost,
  client: AppServerClient,
  thread: Thread,
  message: string,
): Promise<ThreadReferenceInput | null> {
  try {
    const response = await client.threadTurnsList(thread.id, null, REFERENCED_THREAD_TURN_LIMIT);
    const turns = referencedThreadTurns(chronologicalConversationSummariesFromTurnRecords(response.data));
    if (turns.length === 0) {
      host.status.addSystemMessage("Referenced thread has no readable conversation turns.");
      return null;
    }
    const reference = referencedThreadPromptBundle(thread, turns, message);
    const messageInput = host.codexInput(message);
    host.status.setStatus(reference.status);
    return {
      input: codexTextInputWithAttachments(reference.prompt, messageInput),
      referencedThread: reference.referencedThread,
    };
  } catch (error) {
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}

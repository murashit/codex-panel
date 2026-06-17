import type { AppServerClient } from "../../../../app-server/connection/client";
import { codexTextInputWithAttachments, type CodexInput } from "../../../../domain/chat/input";
import { readReferencedThreadConversationSummaries } from "../../../../app-server/threads";
import { referencedThreadPromptBundle, REFERENCED_THREAD_TURN_LIMIT } from "../../../../domain/threads/reference";
import type { Thread } from "../../../../domain/threads/model";
import { shortThreadId } from "../../../../utils";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandActionPorts,
  type SlashCommandExecutionResult,
  type ThreadReferenceInput,
} from "./slash-command-execution";
import type { SlashCommandName } from "../composer/slash-commands";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import { submissionStateSnapshot } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import { currentModel, runtimeConfigOrDefault } from "../../domain/runtime/effective";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";

export interface SlashCommandHandlerHost extends SlashCommandActionPorts {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  codexInput: (text: string) => CodexInput;
  setStatus: (status: string) => void;
}

function referencedThreadStatus(thread: Thread, includedTurns: number): string {
  return `Referencing ${shortThreadId(thread.id)} (${String(includedTurns)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`;
}

function referencedThreadUnreadableMessage(): string {
  return "Referenced thread has no readable conversation turns.";
}

export async function executeSlashCommandWithState(
  host: SlashCommandHandlerHost,
  command: SlashCommandName,
  args: string,
): Promise<SlashCommandExecutionResult | undefined> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const client = host.currentClient();
  if (!client && command !== "reconnect" && command !== "compact") return;
  return runSlashCommand(command, args, {
    ...host,
    activeThreadId: state.activeThreadId,
    listedThreads: state.listedThreads,
    busy: state.busy,
    referThread: (thread, message) => {
      if (!client) return Promise.resolve(null);
      return referencedThreadInput(host, client, thread, message);
    },
    supportedReasoningEfforts: () => supportedReasoningEfforts(host.stateStore.getState()),
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
    const turns = await readReferencedThreadConversationSummaries(client, thread.id, REFERENCED_THREAD_TURN_LIMIT);
    if (turns.length === 0) {
      host.addSystemMessage(referencedThreadUnreadableMessage());
      return null;
    }
    const reference = referencedThreadPromptBundle(thread, turns, message);
    const messageInput = host.codexInput(message);
    host.setStatus(referencedThreadStatus(thread, turns.length));
    return {
      input: codexTextInputWithAttachments(reference.prompt, messageInput),
      referencedThread: reference.referencedThread,
    };
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}

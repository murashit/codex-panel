import type { AppServerClient } from "../../../../app-server/connection/client";
import { codexTextInputWithAttachments, type CodexInput } from "../../../../domain/chat/input";
import { readReferencedThreadConversationSummaries } from "../../../../app-server/threads/data";
import { referencedThreadPromptBundle, REFERENCED_THREAD_TURN_LIMIT } from "../../../../domain/threads/reference";
import type { Thread } from "../../../../domain/threads/model";
import { referencedThreadStatus, referencedThreadUnreadableMessage } from "./messages";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandExecutionContext,
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

type DynamicSlashCommandExecutionContext = "activeThreadId" | "busy" | "listedThreads" | "referThread" | "supportedReasoningEfforts";

export interface SlashCommandHandlerHost extends Omit<SlashCommandExecutionContext, DynamicSlashCommandExecutionContext> {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  codexInput: (text: string) => CodexInput;
  setStatus: (status: string) => void;
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

import { readReferencedThreadConversationSummaries, type ThreadConversationSummaryClient } from "../../../../app-server/threads";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import { type CodexInput, codexTextInputWithAttachments } from "../../../../domain/chat/input";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT, referencedThreadPromptBundle } from "../../../../domain/threads/reference";
import { shortThreadId } from "../../../../shared/id/thread-id";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { SlashCommandName } from "../composer/slash-commands";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";
import type { ChatStateStore } from "../state/store";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandExecutionPorts,
  type SlashCommandExecutionResult,
  type ThreadReferenceInput,
} from "./slash-command-execution";
import { submissionStateSnapshot } from "./submission-state";

export interface SlashCommandExecutorHost extends SlashCommandExecutionPorts {
  stateStore: ChatStateStore;
  currentClient: () => ThreadConversationSummaryClient | null;
  codexInput: (text: string) => CodexInput;
  setStatus: (status: string) => void;
}

export async function executeSlashCommandWithState(
  host: SlashCommandExecutorHost,
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
    referThread: (thread, message) => {
      if (!client) return Promise.resolve(null);
      return referencedThreadInput(host, client, thread, message);
    },
    supportedReasoningEfforts: () => supportedReasoningEfforts(host.stateStore.getState()),
  });
}

function supportedReasoningEfforts(state: ReturnType<ChatStateStore["getState"]>): ReasoningEffort[] {
  const config = runtimeConfigOrDefault(state.connection.runtimeConfig);
  const model = findModelMetadataByIdOrName(
    state.connection.availableModels,
    resolveRuntimeControls(runtimeSnapshotForChatState(state), config).model.effective,
  );
  return supportedEffortsForModelMetadata(model);
}

async function referencedThreadInput(
  host: SlashCommandExecutorHost,
  client: ThreadConversationSummaryClient,
  thread: Thread,
  message: string,
): Promise<ThreadReferenceInput | null> {
  try {
    const turns = await readReferencedThreadConversationSummaries(client, thread.id, REFERENCED_THREAD_TURN_LIMIT);
    if (turns.length === 0) {
      host.addSystemMessage("Referenced thread has no readable conversation turns.");
      return null;
    }
    const reference = referencedThreadPromptBundle(thread, turns, message);
    const messageInput = host.codexInput(message);
    host.setStatus(`Referencing ${shortThreadId(thread.id)} (${String(turns.length)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`);
    return {
      input: codexTextInputWithAttachments(reference.prompt, messageInput),
      referencedThread: reference.referencedThread,
    };
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}

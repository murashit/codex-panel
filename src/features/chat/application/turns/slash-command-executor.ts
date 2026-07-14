import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { SlashCommandName } from "../composer/slash-commands";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";
import type { ChatStateStore } from "../state/store";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandExecutionPorts,
  type SlashCommandExecutionResult,
  type ThreadReferenceInput,
  type WebUrlInput,
} from "./slash-command-execution";
import { submissionStateSnapshot } from "./submission-state";

export interface SlashCommandExecutorHost extends SlashCommandExecutionPorts {
  stateStore: ChatStateStore;
  connectionAvailable: () => boolean;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<ThreadReferenceInput | null>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<WebUrlInput>;
  setStatus: (status: string) => void;
}

export async function executeSlashCommandWithState(
  host: SlashCommandExecutorHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot?: ComposerInputSnapshot,
): Promise<SlashCommandExecutionResult | undefined> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  if (state.activeThreadSubagent) {
    throw new Error("Slash commands are unavailable in agent threads. Start a new chat to continue.");
  }
  if (!host.connectionAvailable() && command !== "reconnect" && command !== "compact") return;
  return runSlashCommand(command, args, {
    ...host,
    activeThreadId: state.activeThreadId,
    activeThreadEphemeral: state.activeThreadEphemeral,
    listedThreads: state.listedThreads,
    referThread: host.referThread,
    readWebUrl: host.readWebUrl,
    ...(inputSnapshot !== undefined ? { inputSnapshot } : {}),
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

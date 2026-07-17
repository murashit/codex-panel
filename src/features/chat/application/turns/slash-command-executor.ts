import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import { activePanelOperationForSlashCommand, type SlashCommandName, slashCommandRequiresConnection } from "../composer/slash-commands";
import { activePanelOperationDecision } from "../panel-operation-policy";
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
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<WebUrlInput>;
  setStatus: (status: string) => void;
}

export async function executeSlashCommandWithState(
  host: SlashCommandExecutorHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot?: ComposerInputSnapshot,
  isWebImportCurrent?: () => boolean,
): Promise<SlashCommandExecutionResult | undefined> {
  const chatState = host.stateStore.getState();
  const operation = activePanelOperationForSlashCommand(command, args);
  if (operation) {
    const decision = activePanelOperationDecision(chatState, operation);
    if (decision.kind === "blocked") throw new Error(decision.message);
  }
  const state = submissionStateSnapshot(chatState);
  if (!host.connectionAvailable() && slashCommandRequiresConnection(command)) return;
  return runSlashCommand(command, args, {
    ...host,
    activeThreadId: state.activeThreadId,
    listedThreads: state.listedThreads,
    referThread: host.referThread,
    readWebUrl: host.readWebUrl,
    ...(inputSnapshot !== undefined ? { inputSnapshot } : {}),
    ...(isWebImportCurrent ? { isWebImportCurrent } : {}),
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

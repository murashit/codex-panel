import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionAdoption } from "../composer/submission-claim";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";
import { activePanelOperationForSlashCommand, type SlashCommandName, slashCommandRequiresConnection } from "../slash-commands/catalog";
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
  sharedResources: Parameters<typeof runtimeSnapshotForChatState>[1];
  listedThreads: () => readonly Thread[];
}

export async function executeSlashCommandWithState(
  host: SlashCommandExecutorHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot?: ComposerInputSnapshot,
  submission: ComposerSubmissionAdoption = NOOP_SUBMISSION_ADOPTION,
): Promise<SlashCommandExecutionResult | undefined> {
  const chatState = host.stateStore.getState();
  const operation = activePanelOperationForSlashCommand(command, args);
  if (operation) {
    const decision = activePanelOperationDecision(chatState, operation);
    if (decision.kind === "blocked") throw new Error(decision.message);
  }
  const state = submissionStateSnapshot(chatState);
  const listedThreads = host.listedThreads();
  if (!host.connectionAvailable() && slashCommandRequiresConnection(command)) return;
  return runSlashCommand(command, args, {
    ...host,
    addSystemMessage: (text) => {
      if (submission.isCurrent()) host.addSystemMessage(text);
    },
    addStructuredSystemMessage: (text, details) => {
      if (submission.isCurrent()) host.addStructuredSystemMessage(text, details);
    },
    activeThreadId: state.activeThreadId,
    listedThreads,
    ...(inputSnapshot?.threadCommandTarget ? { threadCommandTarget: inputSnapshot.threadCommandTarget } : {}),
    referThread: host.referThread,
    readWebUrl: host.readWebUrl,
    ...(inputSnapshot !== undefined ? { inputSnapshot } : {}),
    submission,
    supportedReasoningEfforts: () => supportedReasoningEfforts(host.stateStore.getState(), host.sharedResources),
  });
}

const NOOP_SUBMISSION_ADOPTION: ComposerSubmissionAdoption = {
  isCurrent: () => true,
  markAdopted: () => undefined,
  adoptPanelTarget: () => undefined,
};

function supportedReasoningEfforts(
  state: ReturnType<ChatStateStore["getState"]>,
  sharedResources: Parameters<typeof runtimeSnapshotForChatState>[1],
): ReasoningEffort[] {
  const config = runtimeConfigOrDefault(sharedResources.runtimeConfigSnapshot());
  const model = findModelMetadataByIdOrName(
    sharedResources.modelsSnapshot() ?? [],
    resolveRuntimeControls(runtimeSnapshotForChatState(state, sharedResources), config).model.effective,
  );
  return supportedEffortsForModelMetadata(model);
}

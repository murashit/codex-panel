import type { Thread } from "../../../../domain/threads/model";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionAdoption } from "../composer/submission-claim";
import { activePanelOperationDecision } from "../panel-operation-policy";
import type { runtimeSnapshotForChatState } from "../runtime/snapshot";
import { activeThreadId } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { activePanelOperationForSlashCommand, type SlashCommandName, slashCommandRequiresConnection } from "./catalog";
import {
  executeSlashCommand as runSlashCommand,
  type SlashCommandExecutionPorts,
  type SlashCommandExecutionResult,
  type ThreadReferenceInput,
  type WebUrlInput,
} from "./execute";

export interface PanelSlashCommandHost extends SlashCommandExecutionPorts {
  stateStore: ChatStateStore;
  connectionAvailable: () => boolean;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<ThreadReferenceInput | null>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<WebUrlInput>;
  sharedResources: Parameters<typeof runtimeSnapshotForChatState>[1];
  listedThreads: () => readonly Thread[];
}

export async function executePanelSlashCommand(
  host: PanelSlashCommandHost,
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
    activeThreadId: activeThreadId(chatState),
    listedThreads,
    ...(inputSnapshot?.threadCommandTarget ? { threadCommandTarget: inputSnapshot.threadCommandTarget } : {}),
    referThread: host.referThread,
    readWebUrl: host.readWebUrl,
    ...(inputSnapshot !== undefined ? { inputSnapshot } : {}),
    submission,
  });
}

const NOOP_SUBMISSION_ADOPTION: ComposerSubmissionAdoption = {
  isCurrent: () => true,
  markAdopted: () => undefined,
  adoptPanelTarget: () => undefined,
};

import type { Thread } from "../../../../domain/threads/model";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { PreparedInput } from "../composer/prepared-input";
import { activePanelOperationDecision } from "../panel-operation-policy";
import type { ChatRuntimeSharedResources } from "../runtime/snapshot";
import { activeThreadId } from "../state/model";
import type { ChatStateStore } from "../state/store";
import type { ComposerSubmissionAdoption } from "../submission/input-claim";
import { activePanelOperationForSlashCommand, type SlashCommandName, slashCommandRequiresConnection } from "./catalog";
import { executeSlashCommand as runSlashCommand } from "./execute";
import type { SlashCommandExecutionPorts, SlashCommandExecutionResult } from "./execution-contracts";

export interface PanelSlashCommandHost extends SlashCommandExecutionPorts {
  stateStore: ChatStateStore;
  connectionAvailable: () => boolean;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<PreparedInput>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<PreparedInput>;
  sharedResources: ChatRuntimeSharedResources;
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

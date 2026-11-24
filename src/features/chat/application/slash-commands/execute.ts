import type { Thread } from "../../../../domain/threads/model";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { PreparedInput } from "../composer/prepared-input";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId } from "../state/model";
import type { ChatStateStore } from "../state/store";
import type { ComposerSubmissionAdoption } from "../submission/input-claim";
import { validateSlashCommandArguments } from "./arguments";
import { activePanelOperationForSlashCommand, type SlashCommandName, slashCommandRequiresConnection } from "./catalog";
import { executeContextSlashCommand } from "./execute-context";
import { executeRuntimeSlashCommand } from "./execute-runtime";
import { executeThreadSlashCommand } from "./execute-thread";
import type { SlashCommandExecutionContext, SlashCommandExecutionPorts, SlashCommandExecutionResult } from "./execution-contracts";

export async function executeSlashCommand(
  command: SlashCommandName,
  args: string,
  context: SlashCommandExecutionContext,
): Promise<SlashCommandExecutionResult | undefined> {
  const argumentError = validateSlashCommandArguments(command, args);
  if (argumentError) {
    context.addSystemMessage(argumentError);
    return;
  }

  switch (command) {
    case "clear":
    case "resume":
    case "reconnect":
    case "fork":
    case "btw":
    case "rollback":
    case "compact":
    case "archive":
    case "rename":
      return executeThreadSlashCommand(command, args, context);
    case "refer":
    case "web":
    case "goal":
      return executeContextSlashCommand(command, args, context);
    case "fast":
    case "auto-review":
    case "plan":
    case "status":
    case "permissions":
    case "doctor":
    case "tools":
    case "model":
    case "reasoning":
    case "help":
      return executeRuntimeSlashCommand(command, args, context);
  }
  const _exhaustive: never = command;
  return _exhaustive;
}

export interface PanelSlashCommandHost extends SlashCommandExecutionPorts {
  stateStore: ChatStateStore;
  connectionAvailable: () => boolean;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<PreparedInput>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<PreparedInput>;
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
  return executeSlashCommand(command, args, {
    ...host,
    addSystemMessage: (text) => {
      if (submission.isCurrent()) host.addSystemMessage(text);
    },
    addStructuredSystemMessage: (text, details) => {
      if (submission.isCurrent()) host.addStructuredSystemMessage(text, details);
    },
    activeThreadId: activeThreadId(chatState),
    ...(chatState.panelThread.kind === "fork-draft" ? { forkSourceThreadId: chatState.panelThread.draft.sourceThreadId } : {}),
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
  adoptPanelTarget: () => undefined,
};

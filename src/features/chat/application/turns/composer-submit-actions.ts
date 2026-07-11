import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import { type SlashCommandName, slashCommandRequiresConnection } from "../composer/slash-commands";
import { parseSlashCommand } from "../composer/suggestions";
import type { ChatStateStore } from "../state/store";
import type { SlashCommandExecutionResult } from "./slash-command-execution";
import { submissionStateSnapshot } from "./submission-state";
import type { TurnSubmissionRequest } from "./turn-submission-actions";
import type { ChatTurnTransport } from "./turn-transport";

const STATUS_INTERRUPT_REQUESTED = "Interrupt requested.";

export interface ComposerSubmitActionsHost {
  stateStore: ChatStateStore;
  ensureRestoredThreadLoaded?: () => Promise<boolean>;
  composer: {
    readonly trimmedDraft: string;
    setDraft(text: string, options?: { clearSuggestions?: boolean; focus?: boolean; preserveContext?: boolean }): void;
    captureInputSnapshot(): ComposerInputSnapshot;
  };
  slashCommandExecutor: {
    execute(
      command: SlashCommandName,
      args: string,
      inputSnapshot: ComposerInputSnapshot,
    ): Promise<SlashCommandExecutionResult | undefined>;
  };
  turnSubmission: {
    sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
  };
  connection: {
    ensureConnected: () => Promise<boolean>;
  };
  turnTransport: Pick<ChatTurnTransport, "interruptTurn">;
  status: {
    setStatus: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface ComposerSubmitActions {
  submit: () => Promise<void>;
}

export async function submitComposer(host: ComposerSubmitActionsHost): Promise<void> {
  const draft = host.composer.trimmedDraft;
  if (host.ensureRestoredThreadLoaded && !(await host.ensureRestoredThreadLoaded())) return;
  const state = submissionStateSnapshot(host.stateStore.getState());
  if (state.activeThreadSubagent) {
    host.status.addSystemMessage("Messages and slash commands are unavailable in agent threads. Start a new chat to continue.");
    return;
  }
  if (state.busy && state.activeThreadId && state.activeTurnId && draft.length === 0) {
    await interruptTurn(host);
    return;
  }
  await sendMessage(host, draft);
}

async function sendMessage(host: ComposerSubmitActionsHost, text: string): Promise<void> {
  if (!text) return;
  const inputSnapshot = host.composer.captureInputSnapshot();

  const slashCommand = parseSlashCommand(text);
  if (slashCommand) {
    if (slashCommandRequiresConnection(slashCommand.command) && !(await host.connection.ensureConnected())) return;
    const execution = await executeSlashCommandAndRestoreOnFailure(host, slashCommand.command, slashCommand.args, inputSnapshot, text);
    if (execution.failed) return;
    const result = execution.result;
    if (result?.composerDraft !== undefined) {
      host.composer.setDraft(result.composerDraft, { focus: true, clearSuggestions: true });
    }
    if (result?.sendText) {
      host.scroll.showLatest();
      const submitted = await host.turnSubmission.sendTurnText({
        text: result.sendText,
        inputSnapshot,
        ...(result.sendInput !== undefined ? { codexInputOverride: result.sendInput } : {}),
        ...(result.referencedThread !== undefined ? { referencedThread: result.referencedThread } : {}),
        ...(result.sendInput !== undefined ? { preserveComposerContextOnFailure: true } : {}),
      });
      if (!submitted) host.composer.setDraft(text, { focus: true, clearSuggestions: true });
    }
    if (result === undefined || (result.sendText === undefined && result.composerDraft === undefined)) {
      host.composer.setDraft("", { clearSuggestions: true });
    }
    return;
  }

  host.scroll.showLatest();
  await host.turnSubmission.sendTurnText({ text, inputSnapshot });
}

async function executeSlashCommandAndRestoreOnFailure(
  host: ComposerSubmitActionsHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot: ComposerInputSnapshot,
  originalText: string,
): Promise<{ failed: false; result: SlashCommandExecutionResult | undefined } | { failed: true }> {
  try {
    return { failed: false, result: await host.slashCommandExecutor.execute(command, args, inputSnapshot) };
  } catch (error) {
    host.composer.setDraft(originalText, { focus: true, clearSuggestions: true });
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    return { failed: true };
  }
}

async function interruptTurn(host: ComposerSubmitActionsHost): Promise<void> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const turnId = state.activeTurnId;
  if (!state.activeThreadId || !turnId) return;
  try {
    if (!(await host.turnTransport.interruptTurn(state.activeThreadId, turnId))) return;
    host.status.setStatus(STATUS_INTERRUPT_REQUESTED);
  } catch (error) {
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

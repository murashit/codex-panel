import type { AppServerClient } from "../../../../app-server/client";
import type { CodexInput } from "../../../../app-server/request-input";
import { submissionStateSnapshot } from "../../state/selectors";
import type { ChatStateStore } from "../../state/reducer";
import { parseSlashCommand } from "../composer/suggestions";
import type { SlashCommandExecutionResult } from "./slash-command-execution";
import type { SlashCommandName } from "../composer/slash-commands";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";

interface ComposerDraftPort {
  readonly trimmedDraft: string;
  setDraft(text: string, options?: { clearSuggestions?: boolean; focus?: boolean }): void;
}

interface ComposerSlashCommandPort {
  execute(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined>;
}

interface ComposerTurnSubmissionPort {
  sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadDisplay): Promise<void>;
}

interface ComposerConnectionPort {
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
}

interface ComposerStatusPort {
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

interface ComposerScrollPort {
  followBottom: () => void;
}

export interface ComposerSubmitActionsHost {
  stateStore: ChatStateStore;
  composer: ComposerDraftPort;
  slashCommands: ComposerSlashCommandPort;
  turnSubmission: ComposerTurnSubmissionPort;
  connection: ComposerConnectionPort;
  status: ComposerStatusPort;
  scroll: ComposerScrollPort;
}

export interface ComposerSubmitActions {
  submit: () => Promise<void>;
}

export function createComposerSubmitActions(host: ComposerSubmitActionsHost): ComposerSubmitActions {
  return {
    submit: () => submitComposer(host),
  };
}

async function submitComposer(host: ComposerSubmitActionsHost): Promise<void> {
  const draft = host.composer.trimmedDraft;
  const state = submissionStateSnapshot(host.stateStore.getState());
  if (state.busy && state.activeThreadId && state.activeTurnId && draft.length === 0) {
    await interruptTurn(host);
    return;
  }
  await sendMessage(host);
}

async function sendMessage(host: ComposerSubmitActionsHost): Promise<void> {
  const text = host.composer.trimmedDraft;
  if (!text) return;

  await host.connection.ensureConnected();
  if (!host.connection.currentClient()) return;

  const slashCommand = parseSlashCommand(text);
  if (slashCommand) {
    host.composer.setDraft("", { clearSuggestions: true });
    const result = await host.slashCommands.execute(slashCommand.command, slashCommand.args);
    if (result?.composerDraft !== undefined) {
      host.composer.setDraft(result.composerDraft, { focus: true, clearSuggestions: true });
    }
    if (result?.sendText) {
      host.scroll.followBottom();
      await host.turnSubmission.sendTurnText(result.sendText, result.sendInput, result.referencedThread);
    }
    return;
  }

  host.scroll.followBottom();
  await host.turnSubmission.sendTurnText(text);
}

async function interruptTurn(host: ComposerSubmitActionsHost): Promise<void> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const turnId = state.activeTurnId;
  const client = host.connection.currentClient();
  if (!client || !state.activeThreadId || !turnId) return;
  try {
    await client.interruptTurn(state.activeThreadId, turnId);
    host.status.setStatus("Interrupt requested.");
  } catch (error) {
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

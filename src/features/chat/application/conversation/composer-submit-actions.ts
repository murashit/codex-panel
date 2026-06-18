import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import { submissionStateSnapshot } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import { parseSlashCommand } from "../composer/suggestions";
import type { SlashCommandExecutionResult } from "./slash-command-execution";
import type { SlashCommandName } from "../composer/slash-commands";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";

const STATUS_INTERRUPT_REQUESTED = "Interrupt requested.";

export interface ComposerSubmitActionsHost {
  stateStore: ChatStateStore;
  composer: {
    readonly trimmedDraft: string;
    setDraft(text: string, options?: { clearSuggestions?: boolean; focus?: boolean }): void;
  };
  slashCommandExecutor: {
    execute(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined>;
  };
  turnSubmission: {
    sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadMetadata): Promise<void>;
  };
  connection: {
    ensureConnected: () => Promise<void>;
    currentClient: () => AppServerClient | null;
  };
  status: {
    setStatus: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  scroll: {
    followBottom: () => void;
  };
}

export interface ComposerSubmitActions {
  submit: () => Promise<void>;
}

export async function submitComposer(host: ComposerSubmitActionsHost): Promise<void> {
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
    const result = await host.slashCommandExecutor.execute(slashCommand.command, slashCommand.args);
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
    host.status.setStatus(STATUS_INTERRUPT_REQUESTED);
  } catch (error) {
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

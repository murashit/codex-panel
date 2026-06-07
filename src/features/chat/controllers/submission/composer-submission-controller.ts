import type { AppServerClient } from "../../../../app-server/client";
import { parseSlashCommand } from "../../composer/suggestions";
import type { SlashCommandExecutionResult } from "../../slash-command-execution";
import type { SlashCommandName } from "../../composer/slash-commands";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";
import type { UserInput } from "../../../../generated/app-server/v2/UserInput";
import type { SubmissionStatePort } from "../state-ports";

interface ComposerDraftPort {
  readonly trimmedDraft: string;
  setDraft(text: string, options?: { clearSuggestions?: boolean; focus?: boolean }): void;
}

interface ComposerSlashCommandPort {
  execute(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined>;
}

interface ComposerTurnSubmissionPort {
  sendTurnText(text: string, codexInputOverride?: UserInput[], referencedThread?: ReferencedThreadDisplay): Promise<void>;
}

interface ComposerConnectionPort {
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
}

interface ComposerStatusPort {
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export interface ComposerSubmissionControllerHost {
  state: SubmissionStatePort;
  composer: ComposerDraftPort;
  slashCommands: ComposerSlashCommandPort;
  turnSubmission: ComposerTurnSubmissionPort;
  connection: ComposerConnectionPort;
  status: ComposerStatusPort;
}

export class ComposerSubmissionController {
  constructor(private readonly host: ComposerSubmissionControllerHost) {}

  async submit(): Promise<void> {
    const draft = this.host.composer.trimmedDraft;
    const state = this.host.state.snapshot();
    if (state.busy && state.activeThreadId && state.activeTurnId && draft.length === 0) {
      await this.interruptTurn();
      return;
    }
    await this.sendMessage();
  }

  private async sendMessage(): Promise<void> {
    const text = this.host.composer.trimmedDraft;
    if (!text) return;

    await this.host.connection.ensureConnected();
    if (!this.host.connection.currentClient()) return;

    const slashCommand = parseSlashCommand(text);
    if (slashCommand) {
      this.host.composer.setDraft("", { clearSuggestions: true });
      const result = await this.host.slashCommands.execute(slashCommand.command, slashCommand.args);
      if (result?.composerDraft !== undefined) {
        this.host.composer.setDraft(result.composerDraft, { focus: true, clearSuggestions: true });
      }
      if (result?.sendText) {
        await this.host.turnSubmission.sendTurnText(result.sendText, result.sendInput, result.referencedThread);
      }
      return;
    }

    await this.host.turnSubmission.sendTurnText(text);
  }

  private async interruptTurn(): Promise<void> {
    const state = this.host.state.snapshot();
    const turnId = state.activeTurnId;
    const client = this.host.connection.currentClient();
    if (!client || !state.activeThreadId || !turnId) return;
    try {
      await client.interruptTurn(state.activeThreadId, turnId);
      this.host.status.setStatus("Interrupt requested.");
    } catch (error) {
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

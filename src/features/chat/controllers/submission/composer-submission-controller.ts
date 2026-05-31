import type { AppServerClient } from "../../../../app-server/client";
import { parseSlashCommand } from "../../composer/suggestions";
import type { ChatComposerController } from "../../chat-composer-controller";
import type { SlashCommandController } from "./slash-command-controller";
import type { TurnSubmissionController } from "./turn-submission-controller";
import type { SubmissionStatePort } from "../state-ports";

export interface ComposerSubmissionControllerHost {
  state: SubmissionStatePort;
  composer: ChatComposerController;
  slashCommands: SlashCommandController;
  turnSubmission: TurnSubmissionController;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
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

    await this.host.ensureConnected();
    if (!this.host.currentClient()) return;

    const slashCommand = parseSlashCommand(text);
    if (slashCommand) {
      this.host.composer.setDraft("", { clearSuggestions: true });
      const result = await this.host.slashCommands.execute(slashCommand.command, slashCommand.args);
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
    const client = this.host.currentClient();
    if (!client || !state.activeThreadId || !turnId) return;
    try {
      await client.interruptTurn(state.activeThreadId, turnId);
      this.host.setStatus("Interrupt requested.");
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

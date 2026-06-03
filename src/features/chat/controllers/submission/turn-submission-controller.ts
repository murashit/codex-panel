import type { AppServerClient } from "../../../../app-server/client";
import type { UserInput } from "../../../../generated/app-server/v2/UserInput";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./turn-submission";
import type { SubmissionStatePort } from "../state-ports";

export interface TurnSubmissionControllerHost {
  state: SubmissionStatePort;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: (preview?: string) => Promise<unknown>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  codexInput: (text: string) => UserInput[];
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
  forceMessagesToBottom: () => void;
  render: () => void;
  scheduleRender: () => void;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export class TurnSubmissionController {
  constructor(private readonly host: TurnSubmissionControllerHost) {}

  async sendTurnText(text: string, codexInputOverride?: UserInput[], referencedThread?: ReferencedThreadDisplay): Promise<void> {
    if (!(await this.host.ensureRestoredThreadLoaded())) return;
    const client = this.host.currentClient();
    if (!client) return;

    if (this.state.busy) {
      await this.steerCurrentTurn(client, text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!this.state.activeThreadId) {
        const threadResponse = await this.host.startThread(text);
        if (!threadResponse) return;
        this.host.notifyActiveThreadIdentityChanged();
        this.host.resetThreadTurnPresence(false);
      }
      const activeThreadId = this.state.activeThreadId;
      if (!activeThreadId) return;
      if (!(await this.host.applyPendingThreadSettings())) return;

      const codexInput = codexInputOverride ?? this.host.codexInput(text);
      optimisticUserId = `local-user-${String(Date.now())}`;
      const optimistic = optimisticTurnStart({
        id: optimisticUserId,
        text,
        codexInput,
        referencedThread,
      });
      this.host.state.optimisticTurnStarted(optimistic.item, optimistic.pendingTurnStart);
      this.host.forceMessagesToBottom();
      this.host.setDraft("");
      this.host.render();

      const response = await client.startTurn(activeThreadId, this.host.vaultPath, codexInput, optimisticUserId);
      const pendingStart = this.state.pendingTurnStart;
      if (
        shouldAcknowledgeTurnStart({
          pendingTurnStart: pendingStart,
          activeTurnId: this.state.activeTurnId,
          optimisticUserId,
          responseTurnId: response.turn.id,
        })
      ) {
        const displayItems = acknowledgeOptimisticTurnStart({
          items: this.state.displayItems,
          optimisticUserId,
          turnId: response.turn.id,
          pendingTurnStart: pendingStart,
        });
        this.host.state.turnStartAcknowledged(response.turn.id, displayItems);
        this.host.setStatus("Turn running...");
      }
    } catch (error) {
      const displayItems = cleanupFailedTurnStart({
        items: this.state.displayItems,
        optimisticUserId,
        pendingTurnStart: this.state.pendingTurnStart,
      });
      this.host.state.turnStartFailed(displayItems);
      this.host.setDraft(text);
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    this.host.scheduleRender();
  }

  private async steerCurrentTurn(
    client: AppServerClient,
    text: string,
    codexInputOverride?: UserInput[],
    referencedThread?: ReferencedThreadDisplay,
  ): Promise<void> {
    const threadId = this.state.activeThreadId;
    const expectedTurnId = this.state.activeTurnId;
    if (!threadId || !expectedTurnId) {
      this.host.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const codexInput = codexInputOverride ?? this.host.codexInput(text);
    this.host.setDraft("", { clearSuggestions: true });

    try {
      await client.steerTurn(threadId, expectedTurnId, codexInput);
      this.host.state.addLocalUserMessage(
        localUserMessageItemFromInput({
          id: `local-steer-${String(Date.now())}`,
          text,
          turnId: expectedTurnId,
          referencedThread,
          codexInput,
        }),
      );
      this.host.forceMessagesToBottom();
      this.host.setStatus("Steered current turn.");
    } catch (error) {
      this.host.setDraft(text, { focus: true });
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.host.scheduleRender();
  }

  private get state() {
    return this.host.state.snapshot();
  }
}

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

export interface TurnSubmissionConnectionPort {
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export interface TurnSubmissionRestoredThreadPort {
  ensureRestoredThreadLoaded: () => Promise<boolean>;
}

export interface TurnSubmissionThreadPort {
  startThread: (preview?: string) => Promise<unknown>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
}

export interface TurnSubmissionRuntimePort {
  applyPendingThreadSettings: () => Promise<boolean>;
}

export interface TurnSubmissionComposerPort {
  codexInput: (text: string) => UserInput[];
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
}

export interface TurnSubmissionViewPort {
  forceMessagesToBottom: () => void;
  render: () => void;
  scheduleRender: () => void;
}

export interface TurnSubmissionStatusPort {
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export interface TurnSubmissionControllerHost {
  state: SubmissionStatePort;
  connection: TurnSubmissionConnectionPort;
  restoredThread: TurnSubmissionRestoredThreadPort;
  thread: TurnSubmissionThreadPort;
  runtime: TurnSubmissionRuntimePort;
  composer: TurnSubmissionComposerPort;
  view: TurnSubmissionViewPort;
  status: TurnSubmissionStatusPort;
}

export class TurnSubmissionController {
  constructor(private readonly host: TurnSubmissionControllerHost) {}

  async sendTurnText(text: string, codexInputOverride?: UserInput[], referencedThread?: ReferencedThreadDisplay): Promise<void> {
    if (!(await this.host.restoredThread.ensureRestoredThreadLoaded())) return;
    const client = this.host.connection.currentClient();
    if (!client) return;

    if (this.state.busy) {
      await this.steerCurrentTurn(client, text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!this.state.activeThreadId) {
        const threadResponse = await this.host.thread.startThread(text);
        if (!threadResponse) return;
        this.host.thread.notifyActiveThreadIdentityChanged();
        this.host.thread.resetThreadTurnPresence(false);
      }
      const activeThreadId = this.state.activeThreadId;
      if (!activeThreadId) return;
      if (!(await this.host.runtime.applyPendingThreadSettings())) return;

      const codexInput = codexInputOverride ?? this.host.composer.codexInput(text);
      optimisticUserId = `local-user-${String(Date.now())}`;
      const optimistic = optimisticTurnStart({
        id: optimisticUserId,
        text,
        codexInput,
        referencedThread,
      });
      this.host.state.optimisticTurnStarted(optimistic.item, optimistic.pendingTurnStart);
      this.host.view.forceMessagesToBottom();
      this.host.composer.setDraft("");
      this.host.view.render();

      const response = await client.startTurn(activeThreadId, this.host.connection.vaultPath, codexInput, optimisticUserId);
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
        this.host.status.setStatus("Turn running...");
      }
    } catch (error) {
      const displayItems = cleanupFailedTurnStart({
        items: this.state.displayItems,
        optimisticUserId,
        pendingTurnStart: this.state.pendingTurnStart,
      });
      this.host.state.turnStartFailed(displayItems);
      this.host.composer.setDraft(text);
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    this.host.view.scheduleRender();
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
      this.host.status.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const codexInput = codexInputOverride ?? this.host.composer.codexInput(text);
    const localSteerId = `local-steer-${String(Date.now())}`;
    this.host.composer.setDraft("", { clearSuggestions: true });

    try {
      await client.steerTurn(threadId, expectedTurnId, codexInput, localSteerId);
      this.host.state.addLocalUserMessage(
        localUserMessageItemFromInput({
          id: localSteerId,
          text,
          turnId: expectedTurnId,
          referencedThread,
          codexInput,
        }),
      );
      this.host.view.forceMessagesToBottom();
      this.host.status.setStatus("Steered current turn.");
    } catch (error) {
      this.host.composer.setDraft(text, { focus: true });
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.host.view.scheduleRender();
  }

  private get state() {
    return this.host.state.snapshot();
  }
}

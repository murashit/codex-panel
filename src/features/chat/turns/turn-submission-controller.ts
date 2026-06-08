import type { AppServerClient } from "../../../app-server/client";
import type { UserInput } from "../../../generated/app-server/v2/UserInput";
import type { ReferencedThreadDisplay } from "../../../domain/threads/reference";
import {
  addTranscriptItemAction,
  optimisticTurnStartedAction,
  turnStartAcknowledgedAction,
  turnStartFailedAction,
} from "../chat-state-actions";
import { submissionStateSnapshot } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./turn-submission";

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
  stateStore: ChatStateStore;
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

    const initialState = submissionStateSnapshot(this.host.stateStore.getState());
    if (initialState.busy) {
      await this.steerCurrentTurn(client, text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!initialState.activeThreadId) {
        const threadResponse = await this.host.thread.startThread(text);
        if (!threadResponse) return;
        this.host.thread.notifyActiveThreadIdentityChanged();
        this.host.thread.resetThreadTurnPresence(false);
      }
      const activeThreadId = submissionStateSnapshot(this.host.stateStore.getState()).activeThreadId;
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
      this.host.stateStore.dispatch(optimisticTurnStartedAction(optimistic.item, optimistic.pendingTurnStart));
      this.host.view.forceMessagesToBottom();
      this.host.composer.setDraft("");
      this.host.view.render();

      const response = await client.startTurn(activeThreadId, this.host.connection.vaultPath, codexInput, optimisticUserId);
      const acknowledgedState = submissionStateSnapshot(this.host.stateStore.getState());
      const pendingStart = acknowledgedState.pendingTurnStart;
      if (
        shouldAcknowledgeTurnStart({
          pendingTurnStart: pendingStart,
          activeTurnId: acknowledgedState.activeTurnId,
          optimisticUserId,
          responseTurnId: response.turn.id,
        })
      ) {
        const displayItems = acknowledgeOptimisticTurnStart({
          items: acknowledgedState.displayItems,
          optimisticUserId,
          turnId: response.turn.id,
          pendingTurnStart: pendingStart,
        });
        this.host.stateStore.dispatch(turnStartAcknowledgedAction(response.turn.id, displayItems));
        this.host.status.setStatus("Turn running...");
      }
    } catch (error) {
      const failedState = submissionStateSnapshot(this.host.stateStore.getState());
      const displayItems = cleanupFailedTurnStart({
        items: failedState.displayItems,
        optimisticUserId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      this.host.stateStore.dispatch(turnStartFailedAction(displayItems));
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
    const state = submissionStateSnapshot(this.host.stateStore.getState());
    const threadId = state.activeThreadId;
    const expectedTurnId = state.activeTurnId;
    if (!threadId || !expectedTurnId) {
      this.host.status.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const codexInput = codexInputOverride ?? this.host.composer.codexInput(text);
    const localSteerId = `local-steer-${String(Date.now())}`;
    this.host.composer.setDraft("", { clearSuggestions: true });

    try {
      await client.steerTurn(threadId, expectedTurnId, codexInput, localSteerId);
      this.host.stateStore.dispatch(
        addTranscriptItemAction(
          localUserMessageItemFromInput({
            id: localSteerId,
            text,
            turnId: expectedTurnId,
            referencedThread,
            codexInput,
          }),
        ),
      );
      this.host.view.forceMessagesToBottom();
      this.host.status.setStatus("Steered current turn.");
    } catch (error) {
      this.host.composer.setDraft(text, { focus: true });
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.host.view.scheduleRender();
  }
}

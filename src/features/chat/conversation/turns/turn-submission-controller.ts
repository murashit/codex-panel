import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";
import { submissionStateSnapshot } from "../../state/selectors";
import type { ChatStateStore } from "../../state/reducer";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./optimistic-turn-start";

export interface TurnSubmissionControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: (preview?: string) => Promise<unknown>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  codexInput: (text: string) => CodexInput;
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export class TurnSubmissionController {
  private static localItemSequence = 0;

  constructor(private readonly host: TurnSubmissionControllerHost) {}

  async sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadDisplay): Promise<void> {
    if (!(await this.host.ensureRestoredThreadLoaded())) return;
    const client = this.host.currentClient();
    if (!client) return;

    const initialState = submissionStateSnapshot(this.host.stateStore.getState());
    if (initialState.busy) {
      await this.steerCurrentTurn(client, text, codexInputOverride, referencedThread);
      return;
    }

    let optimisticUserId: string | null = null;
    try {
      if (!initialState.activeThreadId) {
        const threadResponse = await this.host.startThread(text);
        if (!threadResponse) return;
        this.host.notifyActiveThreadIdentityChanged();
        this.host.resetThreadTurnPresence(false);
      }
      const activeThreadId = submissionStateSnapshot(this.host.stateStore.getState()).activeThreadId;
      if (!activeThreadId) return;
      if (!(await this.host.applyPendingThreadSettings())) return;

      const codexInput = codexInputOverride ?? this.host.codexInput(text);
      optimisticUserId = TurnSubmissionController.nextLocalItemId("local-user");
      const optimistic = optimisticTurnStart({
        id: optimisticUserId,
        text,
        codexInput,
        referencedThread,
      });
      this.host.stateStore.dispatch({
        type: "turn/optimistic-started",
        item: optimistic.item,
        pendingTurnStart: optimistic.pendingTurnStart,
      });
      this.host.setDraft("");

      const response = await client.startTurn({
        threadId: activeThreadId,
        cwd: this.host.vaultPath,
        input: codexInput,
        clientUserMessageId: optimisticUserId,
      });
      const acknowledgedState = submissionStateSnapshot(this.host.stateStore.getState());
      const pendingStart = acknowledgedState.pendingTurnStart;
      if (
        shouldAcknowledgeTurnStart({
          expectedThreadId: activeThreadId,
          activeThreadId: acknowledgedState.activeThreadId,
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
        this.host.stateStore.dispatch({ type: "turn/start-acknowledged", turnId: response.turn.id, displayItems });
        this.host.setStatus("Turn running...");
      }
    } catch (error) {
      const failedState = submissionStateSnapshot(this.host.stateStore.getState());
      if (!optimisticUserId || failedState.pendingTurnStart?.anchorItemId === optimisticUserId) {
        const displayItems = cleanupFailedTurnStart({
          items: failedState.displayItems,
          optimisticUserId,
          pendingTurnStart: failedState.pendingTurnStart,
        });
        this.host.stateStore.dispatch({ type: "turn/start-failed", displayItems });
        this.host.setDraft(text);
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async steerCurrentTurn(
    client: AppServerClient,
    text: string,
    codexInputOverride?: CodexInput,
    referencedThread?: ReferencedThreadDisplay,
  ): Promise<void> {
    const state = submissionStateSnapshot(this.host.stateStore.getState());
    const threadId = state.activeThreadId;
    const expectedTurnId = state.activeTurnId;
    if (!threadId || !expectedTurnId) {
      this.host.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const codexInput = codexInputOverride ?? this.host.codexInput(text);
    const localSteerId = TurnSubmissionController.nextLocalItemId("local-steer");
    this.host.setDraft("", { clearSuggestions: true });

    try {
      await client.steerTurn(threadId, expectedTurnId, codexInput, localSteerId);
      if (!this.isCurrentTurn(threadId, expectedTurnId)) return;
      this.host.stateStore.dispatch({
        type: "message-stream/item-added",
        item: localUserMessageItemFromInput({
          id: localSteerId,
          text,
          turnId: expectedTurnId,
          referencedThread,
          codexInput,
        }),
      });
      this.host.setStatus("Steered current turn.");
    } catch (error) {
      if (!this.isCurrentTurn(threadId, expectedTurnId)) return;
      this.host.setDraft(text, { focus: true });
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private isCurrentTurn(threadId: string, turnId: string): boolean {
    const state = submissionStateSnapshot(this.host.stateStore.getState());
    return state.activeThreadId === threadId && state.activeTurnId === turnId;
  }

  private static nextLocalItemId(prefix: "local-user" | "local-steer"): string {
    this.localItemSequence += 1;
    return `${prefix}-${String(Date.now())}-${String(this.localItemSequence)}`;
  }
}

import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import { submissionStateSnapshot } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../../domain/local-id";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./optimistic-turn-start";

const STATUS_TURN_RUNNING = "Turn running...";
const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

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

function currentTurnNotSteerableMessage(): string {
  return "Current turn is not steerable yet.";
}

export class TurnSubmissionController {
  private readonly localItemIds: LocalChatItemIdFactory;

  constructor(private readonly host: TurnSubmissionControllerHost) {
    this.localItemIds = createLocalChatItemIdFactory();
  }

  async sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadMetadata): Promise<void> {
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
      optimisticUserId = this.localItemIds.next("local-user");
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
        const items = acknowledgeOptimisticTurnStart({
          items: acknowledgedState.items,
          optimisticUserId,
          turnId: response.turn.id,
          pendingTurnStart: pendingStart,
        });
        this.host.stateStore.dispatch({ type: "turn/start-acknowledged", turnId: response.turn.id, items });
        this.host.setStatus(STATUS_TURN_RUNNING);
      }
    } catch (error) {
      const failedState = submissionStateSnapshot(this.host.stateStore.getState());
      if (!optimisticUserId || failedState.pendingTurnStart?.anchorItemId === optimisticUserId) {
        const items = cleanupFailedTurnStart({
          items: failedState.items,
          optimisticUserId,
          pendingTurnStart: failedState.pendingTurnStart,
        });
        this.host.stateStore.dispatch({ type: "turn/start-failed", items });
        this.host.setDraft(text);
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async steerCurrentTurn(
    client: AppServerClient,
    text: string,
    codexInputOverride?: CodexInput,
    referencedThread?: ReferencedThreadMetadata,
  ): Promise<void> {
    const state = submissionStateSnapshot(this.host.stateStore.getState());
    const threadId = state.activeThreadId;
    const expectedTurnId = state.activeTurnId;
    if (!threadId || !expectedTurnId) {
      this.host.addSystemMessage(currentTurnNotSteerableMessage());
      return;
    }

    const codexInput = codexInputOverride ?? this.host.codexInput(text);
    const localSteerId = this.localItemIds.next("local-steer");
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
      this.host.setStatus(STATUS_STEERED_CURRENT_TURN);
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
}

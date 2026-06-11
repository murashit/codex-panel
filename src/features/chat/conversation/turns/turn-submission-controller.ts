import type { AppServerClient } from "../../../../app-server/client";
import type { CodexInput } from "../../../../app-server/request-input";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";
import { submissionStateSnapshot } from "../../state/selectors";
import type { ChatStateStore } from "../../state/reducer";
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
  codexInput: (text: string) => CodexInput;
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
}

export interface TurnSubmissionViewPort {
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
  private static localItemSequence = 0;

  constructor(private readonly host: TurnSubmissionControllerHost) {}

  async sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadDisplay): Promise<void> {
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
      this.host.composer.setDraft("");
      this.host.view.render();

      const response = await client.startTurn({
        threadId: activeThreadId,
        cwd: this.host.connection.vaultPath,
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
        this.host.status.setStatus("Turn running...");
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
        this.host.composer.setDraft(text);
        this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    }
    this.host.view.scheduleRender();
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
      this.host.status.addSystemMessage("Current turn is not steerable yet.");
      return;
    }

    const codexInput = codexInputOverride ?? this.host.composer.codexInput(text);
    const localSteerId = TurnSubmissionController.nextLocalItemId("local-steer");
    this.host.composer.setDraft("", { clearSuggestions: true });

    try {
      await client.steerTurn(threadId, expectedTurnId, codexInput, localSteerId);
      if (!this.isCurrentTurn(threadId, expectedTurnId)) return;
      this.host.stateStore.dispatch({
        type: "transcript/item-added",
        item: localUserMessageItemFromInput({
          id: localSteerId,
          text,
          turnId: expectedTurnId,
          referencedThread,
          codexInput,
        }),
      });
      this.host.status.setStatus("Steered current turn.");
    } catch (error) {
      if (!this.isCurrentTurn(threadId, expectedTurnId)) return;
      this.host.composer.setDraft(text, { focus: true });
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    }

    this.host.view.scheduleRender();
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

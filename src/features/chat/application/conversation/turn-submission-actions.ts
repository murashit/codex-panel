import type { AppServerClient } from "../../../../app-server/connection/client";
import type { CodexInput } from "../../../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import { submissionStateSnapshot } from "../state/selectors";
import { STATUS_TURN_RUNNING } from "../state/status-text";
import type { ChatStateStore } from "../state/store";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./optimistic-turn-start";

const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export interface TurnSubmissionActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  localItemIds: LocalIdSource;
  connectedClient: () => Promise<AppServerClient | null>;
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

type TurnSubmissionSnapshot = ReturnType<typeof submissionStateSnapshot>;

type TurnSubmissionPlan =
  | { kind: "blocked"; message: string }
  | { kind: "steer"; threadId: string; turnId: string }
  | { kind: "start-thread-then-turn" }
  | { kind: "start-turn"; threadId: string };

function currentTurnNotSteerableMessage(): string {
  return "Current turn is not steerable yet.";
}

export interface TurnSubmissionActions {
  sendTurnText(text: string, codexInputOverride?: CodexInput, referencedThread?: ReferencedThreadMetadata): Promise<void>;
}

export function createTurnSubmissionActions(host: TurnSubmissionActionsHost): TurnSubmissionActions {
  return {
    sendTurnText: (text, codexInputOverride, referencedThread) =>
      sendTurnText(host, host.localItemIds, text, codexInputOverride, referencedThread),
  };
}

async function sendTurnText(
  host: TurnSubmissionActionsHost,
  localItemIds: LocalIdSource,
  text: string,
  codexInputOverride?: CodexInput,
  referencedThread?: ReferencedThreadMetadata,
): Promise<void> {
  const client = await host.connectedClient();
  if (!client) return;
  if (!(await host.ensureRestoredThreadLoaded())) return;

  const initialState = submissionStateSnapshot(host.stateStore.getState());
  const plan = planTurnSubmission(initialState);

  let optimisticUserId: string | null = null;
  try {
    switch (plan.kind) {
      case "blocked":
        host.addSystemMessage(plan.message);
        return;
      case "steer":
        await steerCurrentTurn(host, localItemIds, client, plan, text, codexInputOverride, referencedThread);
        return;
      case "start-thread-then-turn":
        if (!(await startThreadForTurn(host, text))) return;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = plan.kind === "start-turn" ? plan.threadId : submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
    if (!activeThreadId) return;
    if (!(await host.applyPendingThreadSettings())) return;

    const codexInput = codexInputOverride ?? host.codexInput(text);
    optimisticUserId = localItemIds.next("local-user");
    const optimistic = optimisticTurnStart({
      id: optimisticUserId,
      text,
      codexInput,
      referencedThread,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
    });
    host.setDraft("");

    const response = await client.startTurn({
      threadId: activeThreadId,
      cwd: host.vaultPath,
      input: codexInput,
      clientUserMessageId: optimisticUserId,
    });
    const acknowledgedState = submissionStateSnapshot(host.stateStore.getState());
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
      host.stateStore.dispatch({ type: "turn/start-acknowledged", turnId: response.turn.id, items });
      host.setStatus(STATUS_TURN_RUNNING);
    }
  } catch (error) {
    const failedState = submissionStateSnapshot(host.stateStore.getState());
    if (!optimisticUserId || failedState.pendingTurnStart?.anchorItemId === optimisticUserId) {
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      host.setDraft(text);
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

function planTurnSubmission(state: TurnSubmissionSnapshot): TurnSubmissionPlan {
  if (state.busy) {
    return state.activeThreadId && state.activeTurnId
      ? { kind: "steer", threadId: state.activeThreadId, turnId: state.activeTurnId }
      : { kind: "blocked", message: currentTurnNotSteerableMessage() };
  }
  return state.activeThreadId ? { kind: "start-turn", threadId: state.activeThreadId } : { kind: "start-thread-then-turn" };
}

async function startThreadForTurn(host: TurnSubmissionActionsHost, text: string): Promise<boolean> {
  const threadResponse = await host.startThread(text);
  if (!threadResponse) return false;
  host.notifyActiveThreadIdentityChanged();
  host.resetThreadTurnPresence(false);
  return true;
}

async function steerCurrentTurn(
  host: TurnSubmissionActionsHost,
  localItemIds: LocalIdSource,
  client: AppServerClient,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  text: string,
  codexInputOverride?: CodexInput,
  referencedThread?: ReferencedThreadMetadata,
): Promise<void> {
  const codexInput = codexInputOverride ?? host.codexInput(text);
  const localSteerId = localItemIds.next("local-steer");
  host.setDraft("", { clearSuggestions: true });

  try {
    await client.steerTurn(plan.threadId, plan.turnId, codexInput, localSteerId);
    if (!isCurrentTurn(host, plan.threadId, plan.turnId)) return;
    host.stateStore.dispatch({
      type: "message-stream/item-added",
      item: localUserMessageItemFromInput({
        id: localSteerId,
        text,
        turnId: plan.turnId,
        referencedThread,
        codexInput,
      }),
    });
    host.setStatus(STATUS_STEERED_CURRENT_TURN);
  } catch (error) {
    if (!isCurrentTurn(host, plan.threadId, plan.turnId)) return;
    host.setDraft(text, { focus: true });
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

function isCurrentTurn(host: TurnSubmissionActionsHost, threadId: string, turnId: string): boolean {
  const state = submissionStateSnapshot(host.stateStore.getState());
  return state.activeThreadId === threadId && state.activeTurnId === turnId;
}

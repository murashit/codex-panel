import type { CodexInput } from "../../../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import type { LocalIdSource } from "../local-id-source";
import type { ChatStateStore } from "../state/store";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./optimistic-turn-start";
import { submissionStateSnapshot } from "./submission-state";
import { STATUS_TURN_RUNNING } from "./turn-state";
import type { ChatTurnTransport } from "./turn-transport";

const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export interface TurnSubmissionActionsHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  turnTransport: ChatTurnTransport;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: (preview?: string) => Promise<boolean>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  prepareInput: (text: string) => { text: string; input: CodexInput };
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
  const prepared = codexInputOverride ? { text, input: codexInputOverride } : host.prepareInput(text);
  if (!(await host.turnTransport.ensureConnected())) return;
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
        await steerCurrentTurn(host, localItemIds, plan, text, prepared, referencedThread);
        return;
      case "start-thread-then-turn":
        if (!(await startThreadForTurn(host, prepared.text))) return;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = plan.kind === "start-turn" ? plan.threadId : submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
    if (!activeThreadId) return;
    if (!(await host.applyPendingThreadSettings())) return;

    optimisticUserId = localItemIds.next("local-user");
    const optimistic = optimisticTurnStart({
      id: optimisticUserId,
      text: prepared.text,
      codexInput: prepared.input,
      referencedThread,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
    });
    host.setDraft("");

    const response = await host.turnTransport.startTurn({
      threadId: activeThreadId,
      input: prepared.input,
      clientUserMessageId: optimisticUserId,
    });
    if (!response) {
      const failedState = submissionStateSnapshot(host.stateStore.getState());
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      host.setDraft(text);
      return;
    }
    const acknowledgedState = submissionStateSnapshot(host.stateStore.getState());
    const pendingStart = acknowledgedState.pendingTurnStart;
    if (
      shouldAcknowledgeTurnStart({
        expectedThreadId: activeThreadId,
        activeThreadId: acknowledgedState.activeThreadId,
        pendingTurnStart: pendingStart,
        activeTurnId: acknowledgedState.activeTurnId,
        optimisticUserId,
        responseTurnId: response.turnId,
      })
    ) {
      const items = acknowledgeOptimisticTurnStart({
        items: acknowledgedState.items,
        optimisticUserId,
        turnId: response.turnId,
        pendingTurnStart: pendingStart,
      });
      host.stateStore.dispatch({ type: "turn/start-acknowledged", turnId: response.turnId, items });
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
      : { kind: "blocked", message: "Current turn is not steerable yet." };
  }
  return state.activeThreadId ? { kind: "start-turn", threadId: state.activeThreadId } : { kind: "start-thread-then-turn" };
}

async function startThreadForTurn(host: TurnSubmissionActionsHost, text: string): Promise<boolean> {
  if (!(await host.startThread(text))) return false;
  host.notifyActiveThreadIdentityChanged();
  host.resetThreadTurnPresence(false);
  return true;
}

async function steerCurrentTurn(
  host: TurnSubmissionActionsHost,
  localItemIds: LocalIdSource,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  text: string,
  prepared: { text: string; input: CodexInput },
  referencedThread?: ReferencedThreadMetadata,
): Promise<void> {
  const localSteerId = localItemIds.next("local-steer");
  host.setDraft("", { clearSuggestions: true });

  try {
    const steered = await host.turnTransport.steerTurn({
      threadId: plan.threadId,
      turnId: plan.turnId,
      input: prepared.input,
      clientUserMessageId: localSteerId,
    });
    if (!steered) return;
    if (!isCurrentTurn(host, plan.threadId, plan.turnId)) return;
    host.stateStore.dispatch({
      type: "message-stream/item-added",
      item: localUserMessageItemFromInput({
        id: localSteerId,
        text: prepared.text,
        turnId: plan.turnId,
        referencedThread,
        codexInput: prepared.input,
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

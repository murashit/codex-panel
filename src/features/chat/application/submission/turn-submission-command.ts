import { type CodexInput, codexTextInput } from "../../../../domain/turns/input";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { PreparedInput } from "../composer/prepared-input";
import type { ComposerSubmissionAdoption, ComposerSubmissionClaim } from "../composer/submission-claim";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import type { ChatStateStore } from "../state/store";
import type { ThreadStartOutcome } from "../threads/thread-start-command";
import type { ChatTurnPort } from "../turns/turn-port";
import { STATUS_TURN_RUNNING } from "../turns/turn-state";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserDialogueItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "./optimistic-turn-start";
import { submissionStateSnapshot } from "./snapshot";
import { TurnSubmissionAttempt } from "./turn-submission-attempt";

const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export interface TurnSubmissionCommandHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  turnPort: ChatTurnPort;
  ensureConnected: () => Promise<boolean>;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: (
    preview?: string,
    options?: {
      preservePendingSubmissionId?: string;
      adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"];
    },
  ) => Promise<ThreadStartOutcome>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => PreparedInput;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export interface TurnSubmissionCommand {
  sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
}

type TurnSubmissionSnapshot = ReturnType<typeof submissionStateSnapshot>;

type TurnSubmissionPlan =
  | { kind: "blocked"; message: string }
  | { kind: "steer"; threadId: string; turnId: string }
  | { kind: "start-thread-then-turn" }
  | { kind: "start-turn"; threadId: string };

export interface TurnSubmissionRequest {
  text: string;
  inputSnapshot?: ComposerInputSnapshot;
  codexInputOverride?: CodexInput;
  pendingSubmissionId?: string;
  submissionClaim?: ComposerSubmissionClaim;
}

export function createTurnSubmissionCommand(host: TurnSubmissionCommandHost): TurnSubmissionCommand {
  let submissionInFlight = false;
  return {
    sendTurnText: async (request) => {
      if (submissionInFlight) {
        request.submissionClaim?.settle("failed");
        return false;
      }
      submissionInFlight = true;
      const attempt = new TurnSubmissionAttempt(host.stateStore, request);
      let accepted = false;
      try {
        accepted = await sendTurnText(host, host.localItemIds, request, attempt);
        return accepted;
      } finally {
        submissionInFlight = false;
        attempt.settle(accepted);
      }
    },
  };
}

async function sendTurnText(
  host: TurnSubmissionCommandHost,
  localItemIds: LocalIdSource,
  request: TurnSubmissionRequest,
  attempt: TurnSubmissionAttempt,
): Promise<boolean> {
  const { text, inputSnapshot, codexInputOverride } = request;
  const prepared = codexInputOverride
    ? { text, input: codexInputOverride }
    : inputSnapshot
      ? host.prepareInput(text, inputSnapshot)
      : { text, input: codexTextInput(text) };
  if (!attempt.isCurrent()) return false;
  if (!(await host.ensureConnected())) return false;
  if (!attempt.isCurrent()) return false;
  if (!(await host.ensureRestoredThreadLoaded())) return false;
  if (!attempt.isCurrent()) return false;

  const operationDecision = activePanelOperationDecision(host.stateStore.getState(), "submit");
  if (operationDecision.kind === "blocked") {
    host.addSystemMessage(operationDecision.message);
    return false;
  }

  const initialState = submissionStateSnapshot(host.stateStore.getState());
  const plan = planTurnSubmission(initialState);

  try {
    switch (plan.kind) {
      case "blocked":
        if (attempt.isPendingCurrent()) host.addSystemMessage(plan.message);
        return false;
      case "steer":
        return await steerCurrentTurn(host, localItemIds, plan, prepared, attempt);
      case "start-thread-then-turn":
        if (!attempt.commitPending()) return false;
        {
          const started = await startThreadForTurn(host, prepared.text, attempt);
          if (started.kind === "not-started") {
            attempt.failPending();
            return false;
          }
          if (started.kind === "created-not-activated") {
            attempt.failPending();
            return true;
          }
        }
        attempt.refreshPanelTarget();
        if (!attempt.isCurrent()) return false;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = plan.kind === "start-turn" ? plan.threadId : submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
    if (!activeThreadId) {
      attempt.failPending();
      return false;
    }
    if (!attempt.commitPending()) return false;
    if (attempt.pendingSubmissionId) attempt.markAdopted();
    if (!(await host.applyPendingThreadSettings())) {
      attempt.failPending();
      return false;
    }
    if (!attempt.isCurrent() || submissionStateSnapshot(host.stateStore.getState()).activeThreadId !== activeThreadId) {
      return false;
    }

    const clientUserMessageId = localItemIds.next("local-user");
    const optimisticItemId = attempt.pendingSubmissionId ?? clientUserMessageId;
    attempt.recordOptimistic(activeThreadId, optimisticItemId);
    const optimistic = optimisticTurnStart({
      id: optimisticItemId,
      ...(attempt.pendingSubmissionId ? { clientId: clientUserMessageId } : {}),
      text: prepared.text,
      codexInput: prepared.input,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
      ...(attempt.pendingSubmissionId ? { pendingSubmissionId: attempt.pendingSubmissionId } : {}),
    });
    attempt.markAdopted();

    const outcome = await host.turnPort.startTurn({
      threadId: activeThreadId,
      input: prepared.input,
      clientUserMessageId,
    });
    if (outcome.kind === "not-started") {
      const failedState = submissionStateSnapshot(host.stateStore.getState());
      if (failedState.activeThreadId !== activeThreadId || failedState.pendingTurnStart?.anchorItemId !== optimisticItemId) return false;
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId: optimisticItemId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      return false;
    }
    const response = outcome.value;
    const acknowledgedState = submissionStateSnapshot(host.stateStore.getState());
    const pendingStart = acknowledgedState.pendingTurnStart;
    if (
      shouldAcknowledgeTurnStart({
        expectedThreadId: activeThreadId,
        activeThreadId: acknowledgedState.activeThreadId,
        pendingTurnStart: pendingStart,
        activeTurnId: acknowledgedState.activeTurnId,
        optimisticUserId: optimisticItemId,
        responseTurnId: response.turnId,
      })
    ) {
      const items = acknowledgeOptimisticTurnStart({
        items: acknowledgedState.items,
        optimisticUserId: optimisticItemId,
        turnId: response.turnId,
        pendingTurnStart: pendingStart,
      });
      host.stateStore.dispatch({ type: "turn/start-acknowledged", turnId: response.turnId, items });
      host.setStatus(STATUS_TURN_RUNNING);
    }
    return true;
  } catch (error) {
    const failedState = submissionStateSnapshot(host.stateStore.getState());
    if (attempt.failureStillApplies()) {
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId: attempt.optimisticId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      attempt.failPending();
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

async function startThreadForTurn(
  host: TurnSubmissionCommandHost,
  text: string,
  attempt: TurnSubmissionAttempt,
): Promise<ThreadStartOutcome> {
  const options = {
    ...(attempt.pendingSubmissionId ? { preservePendingSubmissionId: attempt.pendingSubmissionId } : {}),
    ...(attempt.adoptPanelTarget ? { adoptPanelTarget: attempt.adoptPanelTarget } : {}),
  };
  const started = Object.keys(options).length > 0 ? await host.startThread(text, options) : await host.startThread(text);
  if (started.kind !== "created-activated") return started;
  host.notifyActiveThreadIdentityChanged();
  host.resetThreadTurnPresence(false);
  return started;
}

function planTurnSubmission(state: TurnSubmissionSnapshot): TurnSubmissionPlan {
  if (state.busy) {
    return state.activeThreadId && state.activeTurnId
      ? { kind: "steer", threadId: state.activeThreadId, turnId: state.activeTurnId }
      : { kind: "blocked", message: "Current turn is not steerable yet." };
  }
  return state.activeThreadId ? { kind: "start-turn", threadId: state.activeThreadId } : { kind: "start-thread-then-turn" };
}

async function steerCurrentTurn(
  host: TurnSubmissionCommandHost,
  localItemIds: LocalIdSource,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  prepared: PreparedInput,
  attempt: TurnSubmissionAttempt,
): Promise<boolean> {
  if (!attempt.isPendingCurrent()) return false;
  if (!attempt.commitPending()) return false;
  attempt.markAdopted();
  const localSteerId = localItemIds.next("local-steer");
  const item = localUserDialogueItemFromInput({
    id: attempt.pendingSubmissionId ?? localSteerId,
    clientId: localSteerId,
    interaction: "steer",
    text: prepared.text,
    turnId: plan.turnId,
    codexInput: prepared.input,
  });
  host.stateStore.dispatch(
    attempt.pendingSubmissionId
      ? { type: "web-submission/steer-pending", submissionId: attempt.pendingSubmissionId, item }
      : { type: "thread-stream/pending-steer-added", item },
  );
  if (!host.stateStore.getState().activeTurn.pendingSteers.some((pending) => pending.clientId === localSteerId)) return false;

  const outcome = await host.turnPort.steerTurn({
    threadId: plan.threadId,
    turnId: plan.turnId,
    input: prepared.input,
    clientUserMessageId: localSteerId,
  });
  if (outcome.kind === "not-started") {
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    if (attempt.isPendingCurrent()) attempt.failPending();
    return false;
  }
  if (outcome.kind === "delivery-unknown") return true;
  if (outcome.kind === "failed") {
    const targetIsCurrent = steerTargetIsCurrent(host, plan);
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    if (targetIsCurrent) {
      attempt.failPending();
      host.addSystemMessage(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
    }
    return false;
  }
  const targetIsCurrent = steerTargetIsCurrent(host, plan);
  if (!targetIsCurrent && !attempt.pendingSubmissionId) return true;
  if (targetIsCurrent) host.setStatus(STATUS_STEERED_CURRENT_TURN);
  return true;
}

function steerTargetIsCurrent(host: TurnSubmissionCommandHost, plan: Extract<TurnSubmissionPlan, { kind: "steer" }>): boolean {
  return isCurrentTurn(host, plan.threadId, plan.turnId);
}

function isCurrentTurn(host: TurnSubmissionCommandHost, threadId: string, turnId: string): boolean {
  const state = submissionStateSnapshot(host.stateStore.getState());
  return state.activeThreadId === threadId && state.activeTurnId === turnId;
}

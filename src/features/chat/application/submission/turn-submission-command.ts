import { type CodexInput, codexTextInput } from "../../../../domain/chat/input";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionClaim } from "../composer/submission-claim";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
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

const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export interface TurnSubmissionCommandHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  turnPort: ChatTurnPort;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: (
    preview?: string,
    options?: { preservePendingSubmissionId?: string; beforeActivate?: () => void },
  ) => Promise<ThreadStartOutcome>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

type TurnSubmissionSnapshot = ReturnType<typeof submissionStateSnapshot>;

type TurnSubmissionPlan =
  | { kind: "blocked"; message: string }
  | { kind: "steer"; threadId: string; turnId: string }
  | { kind: "start-thread-then-turn" }
  | { kind: "start-turn"; threadId: string };

export interface TurnSubmissionCommand {
  sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
}

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
      let accepted = false;
      try {
        accepted = await sendTurnText(host, host.localItemIds, request);
        return accepted;
      } finally {
        submissionInFlight = false;
        request.submissionClaim?.settle(accepted ? "accepted" : "failed");
      }
    },
  };
}

async function sendTurnText(
  host: TurnSubmissionCommandHost,
  localItemIds: LocalIdSource,
  request: TurnSubmissionRequest,
): Promise<boolean> {
  const { text, inputSnapshot, codexInputOverride } = request;
  let panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const prepared = codexInputOverride
    ? { text, input: codexInputOverride }
    : inputSnapshot
      ? host.prepareInput(text, inputSnapshot)
      : { text, input: codexTextInput(text) };
  if (!submissionScopeIsCurrent(host, request, panelTarget)) return false;
  if (!(await host.turnPort.ensureConnected())) return false;
  if (!submissionScopeIsCurrent(host, request, panelTarget)) return false;
  if (!(await host.ensureRestoredThreadLoaded())) return false;
  if (!submissionScopeIsCurrent(host, request, panelTarget)) return false;

  const operationDecision = activePanelOperationDecision(host.stateStore.getState(), "submit");
  if (operationDecision.kind === "blocked") {
    host.addSystemMessage(operationDecision.message);
    return false;
  }

  const initialState = submissionStateSnapshot(host.stateStore.getState());
  const plan = planTurnSubmission(initialState);

  let optimisticItemId: string | null = null;
  let expectedThreadId: string | null = null;
  try {
    switch (plan.kind) {
      case "blocked":
        if (pendingRequestIsCurrent(host, request)) host.addSystemMessage(plan.message);
        return false;
      case "steer":
        return await steerCurrentTurn(host, localItemIds, plan, prepared, request, panelTarget);
      case "start-thread-then-turn":
        if (!commitPendingRequest(host, request)) return false;
        request.submissionClaim?.markAdopted();
        {
          const started = await startThreadForTurn(
            host,
            prepared.text,
            request.pendingSubmissionId,
            request.submissionClaim?.adoptPanelTarget,
          );
          if (started.kind === "not-started") {
            failPendingRequest(host, request);
            return false;
          }
          if (started.kind === "created-not-activated") {
            failPendingRequest(host, request);
            host.addSystemMessage(
              `Created thread ${started.threadId}, but the connection changed before it could be opened. Select it from history to continue.`,
            );
            return true;
          }
        }
        panelTarget = capturePanelTargetLease(host.stateStore.getState());
        if (!submissionScopeIsCurrent(host, request, panelTarget)) return false;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = plan.kind === "start-turn" ? plan.threadId : submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
    if (!activeThreadId) {
      failPendingRequest(host, request);
      return false;
    }
    expectedThreadId = activeThreadId;
    if (!commitPendingRequest(host, request)) return false;
    if (request.pendingSubmissionId) request.submissionClaim?.markAdopted();
    if (!(await host.applyPendingThreadSettings())) {
      failPendingRequest(host, request);
      return false;
    }
    if (
      !submissionScopeIsCurrent(host, request, panelTarget) ||
      submissionStateSnapshot(host.stateStore.getState()).activeThreadId !== activeThreadId
    ) {
      return false;
    }

    const clientUserMessageId = localItemIds.next("local-user");
    optimisticItemId = request.pendingSubmissionId ?? clientUserMessageId;
    const optimistic = optimisticTurnStart({
      id: optimisticItemId,
      ...(request.pendingSubmissionId ? { clientId: clientUserMessageId } : {}),
      text: prepared.text,
      codexInput: prepared.input,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
      ...(request.pendingSubmissionId ? { pendingSubmissionId: request.pendingSubmissionId } : {}),
    });
    request.submissionClaim?.markAdopted();

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
    if (outcome.kind === "completed-stale") return true;
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
    const currentBeforeAdoption = !optimisticItemId && submissionScopeIsCurrent(host, request, panelTarget);
    const currentAfterAdoption =
      optimisticItemId !== null &&
      failedState.activeThreadId === expectedThreadId &&
      failedState.pendingTurnStart?.anchorItemId === optimisticItemId;
    if (currentBeforeAdoption || currentAfterAdoption) {
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId: optimisticItemId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      failPendingRequest(host, request);
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
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

async function startThreadForTurn(
  host: TurnSubmissionCommandHost,
  text: string,
  pendingSubmissionId?: string,
  beforeActivate?: () => void,
): Promise<ThreadStartOutcome> {
  const options = {
    ...(pendingSubmissionId ? { preservePendingSubmissionId: pendingSubmissionId } : {}),
    ...(beforeActivate ? { beforeActivate } : {}),
  };
  const started = Object.keys(options).length > 0 ? await host.startThread(text, options) : await host.startThread(text);
  if (started.kind !== "created-activated") return started;
  host.notifyActiveThreadIdentityChanged();
  host.resetThreadTurnPresence(false);
  return started;
}

async function steerCurrentTurn(
  host: TurnSubmissionCommandHost,
  localItemIds: LocalIdSource,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  prepared: { text: string; input: CodexInput },
  request: TurnSubmissionRequest,
  panelTarget: PanelTargetLease,
): Promise<boolean> {
  if (!pendingRequestIsCurrent(host, request)) return false;
  if (!commitPendingRequest(host, request)) return false;
  request.submissionClaim?.markAdopted();
  const localSteerId = localItemIds.next("local-steer");
  const item = localUserDialogueItemFromInput({
    id: request.pendingSubmissionId ?? localSteerId,
    clientId: localSteerId,
    interaction: "steer",
    text: prepared.text,
    turnId: plan.turnId,
    codexInput: prepared.input,
  });
  host.stateStore.dispatch(
    request.pendingSubmissionId
      ? { type: "web-submission/steer-pending", submissionId: request.pendingSubmissionId, item }
      : { type: "thread-stream/pending-steer-added", item },
  );
  if (!host.stateStore.getState().threadStream.pendingSteers.some((pending) => pending.clientId === localSteerId)) return false;

  const outcome = await host.turnPort.steerTurn({
    threadId: plan.threadId,
    turnId: plan.turnId,
    input: prepared.input,
    clientUserMessageId: localSteerId,
  });
  if (outcome.kind === "not-started") {
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    if (pendingRequestIsCurrent(host, request)) {
      failPendingRequest(host, request);
    }
    return false;
  }
  if (outcome.kind === "delivery-unknown") return true;
  if (outcome.kind === "failed") {
    const targetIsCurrent = steerTargetIsCurrent(host, plan, panelTarget);
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    if (targetIsCurrent) {
      failPendingRequest(host, request);
      host.addSystemMessage(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
    }
    return false;
  }
  if (outcome.kind === "completed-stale") return true;
  const targetIsCurrent = steerTargetIsCurrent(host, plan, panelTarget);
  if (!targetIsCurrent && !request.pendingSubmissionId) return true;
  if (targetIsCurrent) host.setStatus(STATUS_STEERED_CURRENT_TURN);
  return true;
}

function steerTargetIsCurrent(
  host: TurnSubmissionCommandHost,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  panelTarget: PanelTargetLease,
): boolean {
  return panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget) && isCurrentTurn(host, plan.threadId, plan.turnId);
}

function isCurrentTurn(host: TurnSubmissionCommandHost, threadId: string, turnId: string): boolean {
  const state = submissionStateSnapshot(host.stateStore.getState());
  return state.activeThreadId === threadId && state.activeTurnId === turnId;
}

function pendingRequestIsCurrent(host: TurnSubmissionCommandHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId) return true;
  const state = host.stateStore.getState();
  return pendingSubmissionMatches(
    { pendingSubmission: state.pendingSubmission, activeThreadId: submissionStateSnapshot(state).activeThreadId },
    request.pendingSubmissionId,
  );
}

function submissionScopeIsCurrent(host: TurnSubmissionCommandHost, request: TurnSubmissionRequest, panelTarget: PanelTargetLease): boolean {
  return pendingRequestIsCurrent(host, request) && panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget);
}

function commitPendingRequest(host: TurnSubmissionCommandHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId) return true;
  if (!pendingRequestIsCurrent(host, request)) return false;
  host.stateStore.dispatch({ type: "web-submission/committed", submissionId: request.pendingSubmissionId });
  return pendingRequestIsCurrent(host, request) && host.stateStore.getState().pendingSubmission?.phase === "committed";
}

function failPendingRequest(host: TurnSubmissionCommandHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId || !pendingRequestIsCurrent(host, request)) return false;
  host.stateStore.dispatch({ type: "web-submission/failed", submissionId: request.pendingSubmissionId });
  return true;
}

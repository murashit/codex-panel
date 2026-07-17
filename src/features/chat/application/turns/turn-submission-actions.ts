import { type CodexInput, codexTextInput } from "../../../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import type { ThreadStartOutcome } from "../threads/thread-start-actions";
import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserDialogueItemFromInput,
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
  startThread: (preview?: string, options?: { preservePendingSubmissionId?: string }) => Promise<ThreadStartOutcome>;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  applyPendingThreadSettings: () => Promise<boolean>;
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean; preserveContext?: boolean }) => void;
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
  sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
}

export interface TurnSubmissionRequest {
  text: string;
  inputSnapshot?: ComposerInputSnapshot;
  codexInputOverride?: CodexInput;
  referencedThread?: ReferencedThreadMetadata;
  preserveComposerContextOnFailure?: boolean;
  pendingSubmissionId?: string;
  failureDraft?: string;
}

export function createTurnSubmissionActions(host: TurnSubmissionActionsHost): TurnSubmissionActions {
  let submissionInFlight = false;
  return {
    sendTurnText: async (request) => {
      if (submissionInFlight) return false;
      submissionInFlight = true;
      try {
        return await sendTurnText(host, host.localItemIds, request);
      } finally {
        submissionInFlight = false;
      }
    },
  };
}

async function sendTurnText(
  host: TurnSubmissionActionsHost,
  localItemIds: LocalIdSource,
  request: TurnSubmissionRequest,
): Promise<boolean> {
  const { text, inputSnapshot, codexInputOverride, referencedThread } = request;
  let panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const prepared = codexInputOverride
    ? { text, input: codexInputOverride }
    : inputSnapshot
      ? host.prepareInput(text, inputSnapshot)
      : { text, input: codexTextInput(text) };
  if (!submissionScopeIsCurrent(host, request, panelTarget)) return false;
  if (!(await host.turnTransport.ensureConnected())) return false;
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
        return await steerCurrentTurn(host, localItemIds, plan, text, prepared, request, referencedThread);
      case "start-thread-then-turn":
        if (!commitPendingRequest(host, request)) return false;
        {
          const started = await startThreadForTurn(host, prepared.text, request.pendingSubmissionId);
          if (started.kind === "not-started") {
            if (failPendingRequest(host, request)) restoreSubmittedDraft(host, text, request);
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
      if (failPendingRequest(host, request)) restoreSubmittedDraft(host, text, request);
      return false;
    }
    expectedThreadId = activeThreadId;
    if (!commitPendingRequest(host, request)) return false;
    if (!(await host.applyPendingThreadSettings())) {
      if (failPendingRequest(host, request)) restoreSubmittedDraft(host, text, request);
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
      referencedThread,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
      ...(request.pendingSubmissionId ? { pendingSubmissionId: request.pendingSubmissionId } : {}),
    });
    clearDraftForSubmission(host, request);

    const outcome = await host.turnTransport.startTurn({
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
      restoreSubmittedDraft(host, text, request);
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
      prunePreservedComposerContext(host, request);
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
      restoreSubmittedDraft(host, text, request);
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
  host: TurnSubmissionActionsHost,
  text: string,
  pendingSubmissionId?: string,
): Promise<ThreadStartOutcome> {
  const started = pendingSubmissionId
    ? await host.startThread(text, { preservePendingSubmissionId: pendingSubmissionId })
    : await host.startThread(text);
  if (started.kind !== "created-activated") return started;
  host.notifyActiveThreadIdentityChanged();
  host.resetThreadTurnPresence(false);
  return started;
}

async function steerCurrentTurn(
  host: TurnSubmissionActionsHost,
  localItemIds: LocalIdSource,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  text: string,
  prepared: { text: string; input: CodexInput },
  request: TurnSubmissionRequest,
  referencedThread?: ReferencedThreadMetadata,
): Promise<boolean> {
  if (!pendingRequestIsCurrent(host, request)) return false;
  if (!commitPendingRequest(host, request)) return false;
  const localSteerId = localItemIds.next("local-steer");
  clearDraftForSubmission(host, request, { clearSuggestions: true });

  try {
    const outcome = await host.turnTransport.steerTurn({
      threadId: plan.threadId,
      turnId: plan.turnId,
      input: prepared.input,
      clientUserMessageId: localSteerId,
    });
    if (outcome.kind === "not-started") {
      if (pendingRequestIsCurrent(host, request)) {
        failPendingRequest(host, request);
        restoreSubmittedDraft(host, text, request, { focus: true });
      }
      return false;
    }
    if (outcome.kind === "completed-stale") return true;
    const currentTurn = isCurrentTurn(host, plan.threadId, plan.turnId);
    if (!pendingRequestIsCurrent(host, request) || (!currentTurn && !request.pendingSubmissionId)) return true;
    prunePreservedComposerContext(host, request, { clearSuggestions: true });
    const item = localUserDialogueItemFromInput({
      id: request.pendingSubmissionId ?? localSteerId,
      ...(request.pendingSubmissionId ? { clientId: localSteerId, interaction: "steer" as const } : {}),
      text: prepared.text,
      turnId: plan.turnId,
      referencedThread,
      codexInput: prepared.input,
    });
    host.stateStore.dispatch(
      request.pendingSubmissionId
        ? { type: "web-submission/steer-adopted", submissionId: request.pendingSubmissionId, item }
        : { type: "thread-stream/item-added", item },
    );
    if (currentTurn) host.setStatus(STATUS_STEERED_CURRENT_TURN);
    return true;
  } catch (error) {
    if (
      isCurrentTurn(host, plan.threadId, plan.turnId) ||
      (request.pendingSubmissionId !== undefined && pendingRequestIsCurrent(host, request))
    ) {
      failPendingRequest(host, request);
      restoreSubmittedDraft(host, text, request, { focus: true });
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

function clearDraftForSubmission(
  host: TurnSubmissionActionsHost,
  request: TurnSubmissionRequest,
  options: { clearSuggestions?: boolean } = {},
): void {
  const draftOptions = {
    ...options,
    ...(request.preserveComposerContextOnFailure ? { preserveContext: true } : {}),
  };
  if (Object.keys(draftOptions).length === 0) {
    host.setDraft("");
    return;
  }
  host.setDraft("", draftOptions);
}

function restoreSubmittedDraft(
  host: TurnSubmissionActionsHost,
  text: string,
  request: TurnSubmissionRequest,
  options: { focus?: boolean } = {},
): void {
  host.setDraft(request.failureDraft ?? text, {
    ...options,
    ...(request.preserveComposerContextOnFailure ? { preserveContext: true } : {}),
  });
}

function prunePreservedComposerContext(
  host: TurnSubmissionActionsHost,
  request: TurnSubmissionRequest,
  options: { clearSuggestions?: boolean } = {},
): void {
  if (request.preserveComposerContextOnFailure) host.setDraft("", options);
}

function isCurrentTurn(host: TurnSubmissionActionsHost, threadId: string, turnId: string): boolean {
  const state = submissionStateSnapshot(host.stateStore.getState());
  return state.activeThreadId === threadId && state.activeTurnId === turnId;
}

function pendingRequestIsCurrent(host: TurnSubmissionActionsHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId) return true;
  const state = host.stateStore.getState();
  return pendingSubmissionMatches(
    { pendingSubmission: state.pendingSubmission, activeThreadId: submissionStateSnapshot(state).activeThreadId },
    request.pendingSubmissionId,
  );
}

function submissionScopeIsCurrent(host: TurnSubmissionActionsHost, request: TurnSubmissionRequest, panelTarget: PanelTargetLease): boolean {
  return pendingRequestIsCurrent(host, request) && panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget);
}

function commitPendingRequest(host: TurnSubmissionActionsHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId) return true;
  if (!pendingRequestIsCurrent(host, request)) return false;
  host.stateStore.dispatch({ type: "web-submission/committed", submissionId: request.pendingSubmissionId });
  return pendingRequestIsCurrent(host, request) && host.stateStore.getState().pendingSubmission?.phase === "committed";
}

function failPendingRequest(host: TurnSubmissionActionsHost, request: TurnSubmissionRequest): boolean {
  if (!request.pendingSubmissionId || !pendingRequestIsCurrent(host, request)) return false;
  host.stateStore.dispatch({ type: "web-submission/failed", submissionId: request.pendingSubmissionId });
  return true;
}

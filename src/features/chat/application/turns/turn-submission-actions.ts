import { type CodexInput, codexTextInput } from "../../../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { LocalIdSource } from "../local-id-source";
import type { ChatStateStore } from "../state/store";
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
  startThread: (preview?: string) => Promise<boolean>;
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
  const prepared = codexInputOverride
    ? { text, input: codexInputOverride }
    : inputSnapshot
      ? host.prepareInput(text, inputSnapshot)
      : { text, input: codexTextInput(text) };
  if (!(await host.turnTransport.ensureConnected())) return false;
  if (!(await host.ensureRestoredThreadLoaded())) return false;

  const initialState = submissionStateSnapshot(host.stateStore.getState());
  const plan = planTurnSubmission(initialState);

  let optimisticUserId: string | null = null;
  try {
    switch (plan.kind) {
      case "blocked":
        host.addSystemMessage(plan.message);
        return false;
      case "steer":
        return await steerCurrentTurn(host, localItemIds, plan, text, prepared, request, referencedThread);
      case "start-thread-then-turn":
        if (!(await startThreadForTurn(host, prepared.text))) return false;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = plan.kind === "start-turn" ? plan.threadId : submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
    if (!activeThreadId) return false;
    if (!(await host.applyPendingThreadSettings())) return false;

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
    clearDraftForSubmission(host, request);

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
      restoreSubmittedDraft(host, text, request);
      return false;
    }
    prunePreservedComposerContext(host, request);
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
    return true;
  } catch (error) {
    const failedState = submissionStateSnapshot(host.stateStore.getState());
    if (!optimisticUserId || failedState.pendingTurnStart?.anchorItemId === optimisticUserId) {
      const items = cleanupFailedTurnStart({
        items: failedState.items,
        optimisticUserId,
        pendingTurnStart: failedState.pendingTurnStart,
      });
      host.stateStore.dispatch({ type: "turn/start-failed", items });
      restoreSubmittedDraft(host, text, request);
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

function planTurnSubmission(state: TurnSubmissionSnapshot): TurnSubmissionPlan {
  if (state.activeThreadSubagent) {
    return { kind: "blocked", message: "Messages are unavailable in agent threads. Start a new chat to continue." };
  }
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
  request: TurnSubmissionRequest,
  referencedThread?: ReferencedThreadMetadata,
): Promise<boolean> {
  const localSteerId = localItemIds.next("local-steer");
  clearDraftForSubmission(host, request, { clearSuggestions: true });

  try {
    const steered = await host.turnTransport.steerTurn({
      threadId: plan.threadId,
      turnId: plan.turnId,
      input: prepared.input,
      clientUserMessageId: localSteerId,
    });
    if (!steered) {
      restoreSubmittedDraft(host, text, request, { focus: true });
      return false;
    }
    prunePreservedComposerContext(host, request, { clearSuggestions: true });
    if (!isCurrentTurn(host, plan.threadId, plan.turnId)) return true;
    host.stateStore.dispatch({
      type: "thread-stream/item-added",
      item: localUserDialogueItemFromInput({
        id: localSteerId,
        text: prepared.text,
        turnId: plan.turnId,
        referencedThread,
        codexInput: prepared.input,
      }),
    });
    host.setStatus(STATUS_STEERED_CURRENT_TURN);
    return true;
  } catch (error) {
    if (isCurrentTurn(host, plan.threadId, plan.turnId)) {
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
  host.setDraft(text, {
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

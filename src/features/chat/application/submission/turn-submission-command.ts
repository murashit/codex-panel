import { type CodexInput, codexTextInput } from "../../../../domain/input/input";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { PreparedInput } from "../composer/prepared-input";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadState, type ChatState, pendingForkReplacement } from "../state/model";
import { pendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import { archiveForkSource, type ForkReplacementEffects, type ForkReplacementPublication } from "../threads/fork-replacement";
import type { ThreadStartCommand } from "../threads/thread-start-command";
import type { ChatTurnPort } from "../turns/turn-port";
import { activeTurnId, chatTurnBusy } from "../turns/turn-state";
import type { ComposerSubmissionClaim } from "./input-claim";
import { localUserDialogueItemFromInput } from "./local-user-dialogue";

const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export interface TurnSubmissionCommandHost {
  stateStore: ChatStateStore;
  forkReplacement: ForkReplacementEffects;
  localItemIds: LocalIdSource;
  turnPort: ChatTurnPort;
  ensureConnected: () => Promise<boolean>;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startThread: ThreadStartCommand["startThread"];
  applyPendingThreadSettings: () => Promise<boolean>;
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => PreparedInput;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
}

export interface TurnSubmissionCommand {
  sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
}

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
  submissionClaim: ComposerSubmissionClaim;
}

export function createTurnSubmissionCommand(host: TurnSubmissionCommandHost): TurnSubmissionCommand {
  return {
    sendTurnText: async (request) => {
      let accepted = false;
      try {
        accepted = await sendTurnText(host, host.localItemIds, request);
        return accepted;
      } finally {
        request.submissionClaim.settle(accepted ? "accepted" : "failed");
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
  const prepared = codexInputOverride
    ? { text, input: codexInputOverride }
    : inputSnapshot
      ? host.prepareInput(text, inputSnapshot)
      : { text, input: codexTextInput(text) };
  if (!submissionIsCurrent(host, request)) return false;
  if (!(await host.ensureConnected())) return false;
  if (!submissionIsCurrent(host, request)) return false;
  if (!(await host.ensureRestoredThreadLoaded())) return false;
  if (!submissionIsCurrent(host, request)) return false;

  const operationDecision = activePanelOperationDecision(host.stateStore.getState(), "submit");
  if (operationDecision.kind === "blocked") {
    host.addSystemMessage(operationDecision.message);
    return false;
  }

  const submissionState = host.stateStore.getState();
  const plan = planTurnSubmission(submissionState);
  const replacement = pendingForkReplacement(submissionState);
  let publication: ForkReplacementPublication | undefined;
  let targetThreadId: string | null = plan.kind === "start-turn" ? plan.threadId : null;
  let optimisticItemId: string | null = null;

  try {
    if (replacement && plan.kind !== "blocked" && plan.kind !== "steer") {
      publication = host.forkReplacement.beginPublication(replacement.sourceThreadId);
    }
    switch (plan.kind) {
      case "blocked":
        if (pendingSubmissionIsCurrent(host.stateStore, request.pendingSubmissionId)) host.addSystemMessage(plan.message);
        return false;
      case "steer":
        return await steerCurrentTurn(host, localItemIds, plan, prepared, request);
      case "start-thread-then-turn":
        if (!commitPendingSubmission(host.stateStore, request.pendingSubmissionId)) return false;
        {
          const started = await host.startThread(prepared.text, {
            ...(publication ? { onCreated: publication.attach } : {}),
          });
          if (started.kind !== "created-activated") {
            failPendingSubmission(host.stateStore, request.pendingSubmissionId);
            return false;
          }
          targetThreadId = started.target.threadId;
        }
        if (!submissionIsCurrent(host, request)) return false;
        break;
      case "start-turn":
        break;
    }
    const activeThreadId = targetThreadId;
    if (!activeThreadId) {
      failPendingSubmission(host.stateStore, request.pendingSubmissionId);
      return false;
    }
    if (!commitPendingSubmission(host.stateStore, request.pendingSubmissionId)) return false;
    if (request.pendingSubmissionId) request.submissionClaim.markAdopted();
    if (!(await host.applyPendingThreadSettings())) {
      failPendingSubmission(host.stateStore, request.pendingSubmissionId);
      return false;
    }
    if (!submissionIsCurrent(host, request) || (activeThreadState(host.stateStore.getState())?.id ?? null) !== activeThreadId) {
      return false;
    }

    const clientUserMessageId = localItemIds.next("local-user");
    optimisticItemId = request.pendingSubmissionId ?? clientUserMessageId;
    const optimistic = localUserDialogueItemFromInput({
      id: optimisticItemId,
      ...(request.pendingSubmissionId ? { clientId: clientUserMessageId } : {}),
      text: prepared.text,
      codexInput: prepared.input,
    });
    host.stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic,
      ...(request.pendingSubmissionId ? { pendingSubmissionId: request.pendingSubmissionId } : {}),
    });
    request.submissionClaim.markAdopted();

    const outcome = await host.turnPort.startTurn({
      threadId: activeThreadId,
      input: prepared.input,
      clientUserMessageId,
    });
    if (outcome.kind === "not-started") {
      host.stateStore.dispatch({ type: "turn/start-failed", threadId: activeThreadId, anchorItemId: optimisticItemId });
      return false;
    }
    host.stateStore.dispatch({
      type: "turn/start-acknowledged",
      threadId: activeThreadId,
      anchorItemId: optimisticItemId,
      turnId: outcome.value.turnId,
    });
    if (replacement) {
      host.stateStore.dispatch({ type: "active-thread/fork-replacement-settled", threadId: activeThreadId });
      const acceptedPublication = publication;
      publication = undefined;
      void archiveForkSource(host.forkReplacement, replacement).then((archived) => acceptedPublication?.finish(archived));
    }
    return true;
  } catch (error) {
    const before = host.stateStore.getState();
    const failureApplies =
      optimisticItemId && targetThreadId
        ? host.stateStore.dispatch({ type: "turn/start-failed", threadId: targetThreadId, anchorItemId: optimisticItemId }) !== before
        : submissionIsCurrent(host, request);
    if (failureApplies) {
      failPendingSubmission(host.stateStore, request.pendingSubmissionId);
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return false;
  } finally {
    publication?.finish(false);
  }
}

function planTurnSubmission(state: ChatState): TurnSubmissionPlan {
  const threadId = activeThreadState(state)?.id;
  const turnId = activeTurnId(state.activeTurn);
  if (chatTurnBusy(state.activeTurn)) {
    return threadId && turnId ? { kind: "steer", threadId, turnId } : { kind: "blocked", message: "Current turn is not steerable yet." };
  }
  return threadId ? { kind: "start-turn", threadId } : { kind: "start-thread-then-turn" };
}

async function steerCurrentTurn(
  host: TurnSubmissionCommandHost,
  localItemIds: LocalIdSource,
  plan: Extract<TurnSubmissionPlan, { kind: "steer" }>,
  prepared: PreparedInput,
  request: TurnSubmissionRequest,
): Promise<boolean> {
  if (!pendingSubmissionIsCurrent(host.stateStore, request.pendingSubmissionId)) return false;
  if (!commitPendingSubmission(host.stateStore, request.pendingSubmissionId)) return false;
  request.submissionClaim.markAdopted();
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
  if (!host.stateStore.getState().activeTurn.pendingSteers.some((pending) => pending.clientId === localSteerId)) return false;

  const outcome = await host.turnPort.steerTurn({
    threadId: plan.threadId,
    turnId: plan.turnId,
    input: prepared.input,
    clientUserMessageId: localSteerId,
  });
  if (outcome.kind === "not-started") {
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    failPendingSubmission(host.stateStore, request.pendingSubmissionId);
    return false;
  }
  if (outcome.kind === "delivery-unknown") return true;
  if (outcome.kind === "failed") {
    const targetIsCurrent = steerTargetIsCurrent(host, plan);
    host.stateStore.dispatch({ type: "thread-stream/pending-steer-removed", clientId: localSteerId });
    if (targetIsCurrent) {
      failPendingSubmission(host.stateStore, request.pendingSubmissionId);
      host.addSystemMessage(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
    }
    return false;
  }
  const targetIsCurrent = steerTargetIsCurrent(host, plan);
  if (!targetIsCurrent && !request.pendingSubmissionId) return true;
  if (targetIsCurrent) host.setStatus(STATUS_STEERED_CURRENT_TURN);
  return true;
}

function steerTargetIsCurrent(host: TurnSubmissionCommandHost, plan: Extract<TurnSubmissionPlan, { kind: "steer" }>): boolean {
  const state = host.stateStore.getState();
  return activeThreadState(state)?.id === plan.threadId && activeTurnId(state.activeTurn) === plan.turnId;
}

function submissionIsCurrent(host: TurnSubmissionCommandHost, request: TurnSubmissionRequest): boolean {
  return request.submissionClaim.isCurrent() && pendingSubmissionIsCurrent(host.stateStore, request.pendingSubmissionId);
}

function pendingSubmissionIsCurrent(stateStore: ChatStateStore, submissionId: string | undefined): boolean {
  if (!submissionId) return true;
  const state = stateStore.getState();
  return pendingSubmissionMatches(
    { pendingSubmission: state.pendingSubmission, activeThreadId: activeThreadState(state)?.id ?? null },
    submissionId,
  );
}

function commitPendingSubmission(stateStore: ChatStateStore, submissionId: string | undefined): boolean {
  if (!submissionId) return true;
  if (!pendingSubmissionIsCurrent(stateStore, submissionId)) return false;
  stateStore.dispatch({ type: "web-submission/committed", submissionId });
  return pendingSubmissionIsCurrent(stateStore, submissionId) && stateStore.getState().pendingSubmission?.phase === "committed";
}

function failPendingSubmission(stateStore: ChatStateStore, submissionId: string | undefined): void {
  if (submissionId && pendingSubmissionIsCurrent(stateStore, submissionId))
    stateStore.dispatch({ type: "web-submission/failed", submissionId });
}

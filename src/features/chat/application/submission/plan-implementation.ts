import type { ChatRuntimeState } from "../../domain/runtime/state";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/thread-stream/conversation";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { type ChatThreadStreamViewState, threadStreamItems } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import { type ChatTurnLifecycleState, chatTurnBusy } from "../turns/turn-state";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  ensureConnected(): Promise<boolean>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
}

interface PlanImplementationState {
  hasConversation: boolean;
  modeAllowed: boolean;
  activeTurn: { lifecycle: ChatTurnLifecycleState };
  runtime: { pending: Pick<ChatRuntimeState["pending"], "collaborationMode"> };
  threadStream: ChatThreadStreamViewState;
}

function implementPlanTargetFromState(state: ChatState): PlanImplementationTarget | null {
  return implementPlanTarget({
    hasConversation: activeThreadId(state) !== null || state.panelThread.kind === "fork-draft",
    modeAllowed: activePanelOperationDecision(state, "implement-plan").kind === "allowed",
    activeTurn: state.activeTurn,
    runtime: state.runtime,
    threadStream: chatThreadStreamViewState(state.threadStream, state.activeTurn),
  });
}

export function implementPlanTarget(state: PlanImplementationState): PlanImplementationTarget | null {
  if (
    !state.hasConversation ||
    !state.modeAllowed ||
    chatTurnBusy(state.activeTurn) ||
    state.runtime.pending.collaborationMode.kind !== "set" ||
    state.runtime.pending.collaborationMode.value !== "plan"
  ) {
    return null;
  }
  return latestImplementablePlanTargetFromItems(threadStreamItems(state.threadStream));
}

export async function implementPlan(host: PlanImplementationHost, itemId: string): Promise<void> {
  const initial = host.stateStore.getState();
  if (itemId !== implementPlanTargetFromState(initial)?.itemId) return;
  const target = capturePanelTargetLease(initial);
  if (!(await host.ensureConnected())) return;
  const current = host.stateStore.getState();
  if (!panelTargetLeaseIsCurrent(current, target) || itemId !== implementPlanTargetFromState(current)?.itemId) {
    return;
  }

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

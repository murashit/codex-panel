import type { ChatRuntimeState } from "../../domain/runtime/state";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/thread-stream/conversation";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, activeThreadState, type ChatActiveThreadState, type ChatState } from "../state/model";
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
  activeThread: Pick<ChatActiveThreadState, "id"> | null;
  modeAllowed: boolean;
  activeTurn: { lifecycle: ChatTurnLifecycleState };
  runtime: { pending: Pick<ChatRuntimeState["pending"], "collaborationMode"> };
  threadStream: ChatThreadStreamViewState;
}

function implementPlanTargetFromState(state: ChatState): PlanImplementationTarget | null {
  return implementPlanTarget({
    activeThread: activeThreadState(state),
    modeAllowed: activePanelOperationDecision(state, "implement-plan").kind === "allowed",
    activeTurn: state.activeTurn,
    runtime: state.runtime,
    threadStream: chatThreadStreamViewState(state.threadStream, state.activeTurn),
  });
}

export function implementPlanTarget(state: PlanImplementationState): PlanImplementationTarget | null {
  const { activeThread } = state;
  if (
    !activeThread ||
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
  if (itemId !== implementPlanTargetFromState(host.stateStore.getState())?.itemId) return;
  if (!(await host.ensureConnected())) return;
  if (itemId !== implementPlanTargetFromState(host.stateStore.getState())?.itemId || !activeThreadId(host.stateStore.getState())) {
    return;
  }

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

import type { ChatRuntimeState } from "../../domain/runtime/state";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/thread-stream/selectors";
import { activeThreadId, activeThreadState, type ChatActiveThreadState, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { type ChatThreadStreamState, threadStreamItems } from "../state/thread-stream";
import { type ChatTurnState, chatTurnBusy } from "./turn-state";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  ensureConnected(): Promise<boolean>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
}

interface PlanImplementationState {
  activeThread: Pick<ChatActiveThreadState, "id" | "provenance"> | null;
  turn: ChatTurnState;
  runtime: { pending: Pick<ChatRuntimeState["pending"], "collaborationMode"> };
  threadStream: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">;
}

export function implementPlanTargetFromState(state: ChatState): PlanImplementationTarget | null {
  return implementPlanTarget({
    activeThread: activeThreadState(state),
    turn: state.turn,
    runtime: state.runtime,
    threadStream: state.threadStream,
  });
}

export function implementPlanTarget(state: PlanImplementationState): PlanImplementationTarget | null {
  const { activeThread } = state;
  if (
    !activeThread ||
    activeThread.provenance?.kind === "subagent" ||
    chatTurnBusy(state) ||
    state.runtime.pending.collaborationMode.kind !== "set" ||
    state.runtime.pending.collaborationMode.value !== "plan"
  ) {
    return null;
  }
  return latestImplementablePlanTargetFromItems(threadStreamItems(state.threadStream));
}

export async function implementPlan(host: PlanImplementationHost, itemId: string): Promise<void> {
  if (itemId !== implementPlanTargetFromState(host.stateStore.getState())?.itemId) return;
  if (!(await host.ensureConnected()) || !activeThreadId(host.stateStore.getState())) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

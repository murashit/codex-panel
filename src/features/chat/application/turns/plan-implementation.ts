import type { ChatRuntimeState } from "../../domain/runtime/state";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/thread-stream/selectors";
import type { ChatActiveThreadState } from "../state/root-reducer";
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

export function implementPlanTargetFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id"> & { provenance?: ChatActiveThreadState["provenance"] };
  turn: ChatTurnState;
  runtime: { pending: Pick<ChatRuntimeState["pending"], "collaborationMode"> };
  threadStream: Pick<ChatThreadStreamState, "stableItems" | "activeSegment">;
}): PlanImplementationTarget | null {
  if (
    !state.activeThread.id ||
    state.activeThread.provenance?.kind === "subagent" ||
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
  if (!(await host.ensureConnected()) || !host.stateStore.getState().activeThread.id) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

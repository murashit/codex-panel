import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { ChatRuntimeState } from "../../domain/runtime/state";
import { type ChatMessageStreamState, messageStreamItems } from "../state/message-stream";
import type { ChatActiveThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { type ChatTurnState, chatTurnBusy } from "./turn-state";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  ensureConnected(): Promise<boolean>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
}

export function implementPlanTargetFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id">;
  turn: ChatTurnState;
  runtime: { pending: Pick<ChatRuntimeState["pending"], "collaborationMode"> };
  messageStream: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">;
}): PlanImplementationTarget | null {
  if (!state.activeThread.id || chatTurnBusy(state) || state.runtime.pending.collaborationMode !== "plan") {
    return null;
  }
  return latestImplementablePlanTargetFromItems(messageStreamItems(state.messageStream));
}

export async function implementPlan(host: PlanImplementationHost, itemId: string): Promise<void> {
  if (itemId !== implementPlanTargetFromState(host.stateStore.getState())?.itemId) return;
  if (!(await host.ensureConnected()) || !host.stateStore.getState().activeThread.id) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

import type { AppServerClient } from "../../../../app-server/connection/client";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { ChatRuntimeState } from "../../domain/runtime/state";
import type { ChatStateStore } from "../state/store";
import { chatTurnBusy, type ChatTurnState } from "./turn-state";
import type { ChatActiveThreadState, ChatState } from "../state/root-reducer";
import { messageStreamItems, type ChatMessageStreamState } from "../state/message-stream";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  connectedClient(): Promise<AppServerClient | null>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
}

function canImplementPlanItemId(state: ChatState, itemId: string): boolean {
  return itemId === implementPlanTargetFromState(state)?.itemId;
}

export function implementPlanTargetFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id">;
  turn: ChatTurnState;
  runtime: Pick<ChatRuntimeState, "selectedCollaborationMode">;
  messageStream: Pick<ChatMessageStreamState, "stableItems" | "activeSegment">;
}): PlanImplementationTarget | null {
  if (!state.activeThread.id || chatTurnBusy(state) || state.runtime.selectedCollaborationMode !== "plan") {
    return null;
  }
  return latestImplementablePlanTargetFromItems(messageStreamItems(state.messageStream));
}

export async function implementPlan(host: PlanImplementationHost, itemId: string): Promise<void> {
  if (!canImplementPlanItemId(host.stateStore.getState(), itemId)) return;
  if (!(await host.connectedClient()) || !host.stateStore.getState().activeThread.id) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

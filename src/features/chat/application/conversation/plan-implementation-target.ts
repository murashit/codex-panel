import type { ChatActiveThreadState, ChatMessageStreamState, ChatRuntimeState, ChatState, ChatTurnState } from "../state/root-reducer";
import { chatTurnBusy } from "../state/root-reducer";
import { messageStreamItems } from "../state/message-stream";
import { latestImplementablePlanTargetFromItems, type PlanImplementationTarget } from "../../domain/message-stream/selectors";

export function canImplementPlanItemId(state: ChatState, itemId: string): boolean {
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

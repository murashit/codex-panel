import { activeThreadState, type ChatState } from "../state/model";
import { activeTurnId } from "../turns/turn-state";

/** A panel owns its thread and the children it is still presenting on the parent's current turn. */
export function panelThreadSubscriptions(state: ChatState): readonly string[] {
  const thread = activeThreadState(state);
  if (!thread || thread.lifetime?.kind === "ephemeral") return [];
  const threadIds = [thread.id];
  if (activeTurnId(state.activeTurn)) {
    for (const child of state.activeTurn.subagents.byThreadId.values()) {
      threadIds.push(child.threadId);
    }
  }
  return threadIds;
}

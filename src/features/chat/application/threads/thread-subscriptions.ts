import type { ThreadSubscriptionInterest } from "../../../../domain/threads/model";
import { activeThreadState, type ChatState } from "../state/model";
import { activeTurnId } from "../turns/turn-state";

/** A panel owns its thread and the children it is still presenting on the parent's current turn. */
export function panelThreadSubscriptions(state: ChatState): readonly ThreadSubscriptionInterest[] {
  const thread = activeThreadState(state);
  if (!thread) return [];
  const canResume = thread.lifetime?.kind !== "ephemeral";
  const interests = [{ threadId: thread.id, canResume }];
  if (activeTurnId(state.activeTurn)) {
    for (const child of state.activeTurn.subagents.byThreadId.values()) {
      interests.push({ threadId: child.threadId, canResume });
    }
  }
  return interests;
}

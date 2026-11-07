import type { ThreadSubscriptionInterest } from "../../../../domain/threads/model";
import { activeThreadState, type ChatState } from "../state/model";
import { activeTurnId } from "../turns/turn-state";

/** A panel owns its thread and the children it still presents through activity or unanswered human approvals. */
export function panelThreadSubscriptions(state: ChatState): readonly ThreadSubscriptionInterest[] {
  const thread = activeThreadState(state);
  if (!thread) return [];
  const canResume = thread.lifetime?.kind !== "ephemeral";
  const threadIds = new Set([thread.id]);
  if (activeTurnId(state.activeTurn)) {
    for (const child of state.activeTurn.subagents.byThreadId.values()) {
      threadIds.add(child.threadId);
    }
  }
  for (const approval of state.requests.approvals) {
    if (approval.kind === "humanCommand") threadIds.add(approval.threadId);
  }
  return [...threadIds].map((threadId) => ({ threadId, canResume }));
}

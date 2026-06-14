import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";
import type { ChatState } from "../application/state/reducer";
import type { MessageStreamItem } from "../domain/message-stream/items";
import { latestProposedPlanFromItems } from "../domain/message-stream/selectors";
import type { RestoredThreadState } from "../application/lifecycle";

export function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): OpenCodexPanelSnapshot["turnLifecycle"] {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}

export function latestProposedPlanItem(items: readonly MessageStreamItem[]): MessageStreamItem | null {
  return latestProposedPlanFromItems(items);
}

export function parseRestoredThreadState(state: unknown): RestoredThreadState | null {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  const threadId = record["threadId"];
  if (typeof threadId !== "string" || threadId.trim().length === 0) return null;
  const title = record["threadTitle"];
  return {
    threadId,
    title: typeof title === "string" && title.trim().length > 0 ? title : null,
    explicitName: null,
  };
}

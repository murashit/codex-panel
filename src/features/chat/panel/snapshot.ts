import type { ChatState } from "../application/state/root-reducer";
import type { RestoredThreadState } from "../application/threads/restored-thread-lifecycle";

type OpenCodexPanelTurnLifecycle = { kind: "idle" } | { kind: "starting" } | { kind: "running"; turnId: string };

export interface ChatPanelSnapshot {
  viewId: string;
  threadId: string | null;
  turnLifecycle: OpenCodexPanelTurnLifecycle;
  pendingApprovals: number;
  pendingUserInputs: number;
  pendingMcpElicitations: number;
  hasComposerDraft: boolean;
  connected: boolean;
}

export function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): ChatPanelSnapshot["turnLifecycle"] {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
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

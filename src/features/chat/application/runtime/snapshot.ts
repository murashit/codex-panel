import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { activeThreadRuntimeState, pendingRuntimeIntentState } from "../../domain/runtime/state";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { ChatState } from "../state/root-reducer";
import { threadStreamItems } from "../state/thread-stream";

interface RuntimeSnapshotInput {
  runtimeConfig: ChatState["connection"]["runtimeConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  hasThreadTurns: boolean;
  availableModels: ChatState["connection"]["availableModels"];
}

export function threadStreamItemsHaveThreadTurns(items: readonly ThreadStreamItem[]): boolean {
  return items.some((item) => item.turnId);
}

export function runtimeSnapshotForChatSlices(input: RuntimeSnapshotInput): RuntimeSnapshot {
  const active = activeThreadRuntimeState(input.runtime);
  const pending = pendingRuntimeIntentState(input.runtime);
  return {
    runtimeConfig: input.runtimeConfig,
    activeThreadId: input.activeThread.id,
    active,
    pending,
    tokenUsage: input.activeThread.tokenUsage,
    rateLimit: input.rateLimit,
    hasThreadTurns: input.hasThreadTurns,
    availableModels: input.availableModels,
  };
}

export function runtimeSnapshotForChatState(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    hasThreadTurns: threadStreamItemsHaveThreadTurns(threadStreamItems(state.threadStream)),
    availableModels: state.connection.availableModels,
  });
}

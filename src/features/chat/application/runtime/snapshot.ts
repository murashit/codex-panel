import type { MessageStreamItem } from "../../domain/message-stream/items";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { activeThreadRuntimeState, pendingRuntimeIntentState } from "../../domain/runtime/state";
import { messageStreamItems } from "../state/message-stream";
import type { ChatState } from "../state/root-reducer";

interface RuntimeSnapshotInput {
  runtimeConfig: ChatState["connection"]["runtimeConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  hasThreadTurns: boolean;
  availableModels: ChatState["connection"]["availableModels"];
}

export function messageItemsHaveThreadTurns(items: readonly MessageStreamItem[]): boolean {
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
    hasThreadTurns: messageItemsHaveThreadTurns(messageStreamItems(state.messageStream)),
    availableModels: state.connection.availableModels,
  });
}

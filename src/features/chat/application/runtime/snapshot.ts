import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { activeThreadRuntimeState, pendingRuntimeIntentState } from "../../domain/runtime/state";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { activeThreadState, type ChatState } from "../state/model";
import { threadStreamItems } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";

interface RuntimeSnapshotInput {
  runtimeConfig: RuntimeSnapshot["runtimeConfig"];
  activeThread: { id: string | null; tokenUsage: ThreadTokenUsage | null };
  runtime: ChatState["runtime"];
  rateLimit: RuntimeSnapshot["rateLimit"];
  hasThreadTurns: boolean;
  availableModels: RuntimeSnapshot["availableModels"];
}

export interface ChatRuntimeSharedResources {
  runtimeConfigSnapshot(): RuntimeSnapshot["runtimeConfig"];
  rateLimitsSnapshot(): RuntimeSnapshot["rateLimit"] | undefined;
  modelsSnapshot(): RuntimeSnapshot["availableModels"] | null;
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

export function runtimeSnapshotForChatState(state: ChatState, shared: ChatRuntimeSharedResources): RuntimeSnapshot {
  const activeThread = activeThreadState(state);
  return runtimeSnapshotForChatSlices({
    runtimeConfig: shared.runtimeConfigSnapshot(),
    activeThread: { id: activeThread?.id ?? null, tokenUsage: activeThread?.tokenUsage ?? null },
    runtime: state.runtime,
    rateLimit: shared.rateLimitsSnapshot() ?? null,
    hasThreadTurns: threadStreamItemsHaveThreadTurns(threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn))),
    availableModels: shared.modelsSnapshot() ?? [],
  });
}

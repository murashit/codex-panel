import type { ModelMetadata } from "../../../../domain/runtime/catalog";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/settings";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/usage";
import type { ActiveThreadRuntimeState, PendingRuntimeIntentState } from "./state";

export interface RuntimeSnapshot {
  runtimeConfig: RuntimeConfigSnapshot | null;
  activeThreadId: string | null;
  active: ActiveThreadRuntimeState;
  pending: PendingRuntimeIntentState;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  hasThreadTurns: boolean;
  availableModels: readonly ModelMetadata[];
}

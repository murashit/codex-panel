import type { ModelMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
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

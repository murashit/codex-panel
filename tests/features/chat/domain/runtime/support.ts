import type { ModelMetadata } from "../../../../../src/domain/runtime/catalog";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../../src/domain/runtime/settings";
import type { RuntimeSnapshot } from "../../../../../src/features/chat/domain/runtime/state";
import { initialChatRuntimeState } from "../../../../../src/features/chat/domain/runtime/state";
import { modelMetadataFixture } from "../../../../support/model-metadata";
import { runtimeConfigFromAppServerFixture } from "../../../../support/runtime-config";

interface RuntimeSnapshotPatch extends Partial<Omit<RuntimeSnapshot, "active" | "pending">> {
  active?: Partial<RuntimeSnapshot["active"]>;
  pending?: Partial<RuntimeSnapshot["pending"]>;
}

export function runtimeSnapshot(overrides: RuntimeSnapshotPatch = {}): RuntimeSnapshot {
  const { active, pending, ...snapshotOverrides } = overrides;
  const initial = initialChatRuntimeState();
  const snapshot: RuntimeSnapshot = {
    runtimeConfig: runtimeConfigFromAppServerFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      service_tier: "flex",
      model_context_window: 100_000,
    }),
    activeThreadId: null,
    active: initial.active,
    pending: initial.pending,
    tokenUsage: null,
    rateLimit: null,
    hasThreadTurns: false,
    availableModels: [],
  };
  return {
    ...snapshot,
    ...snapshotOverrides,
    active: {
      ...snapshot.active,
      ...(active && "serviceTier" in active ? { serviceTierKnown: true } : {}),
      ...active,
    },
    pending: {
      ...snapshot.pending,
      ...pending,
    },
  };
}

export function snapshotConfig(snapshot: RuntimeSnapshot): RuntimeConfigSnapshot {
  return runtimeConfigOrDefault(snapshot.runtimeConfig);
}

export function modelFixture(model: string): ModelMetadata {
  return modelMetadataFixture(model, { supportedReasoningEfforts: [], defaultReasoningEffort: "medium", isDefault: false });
}

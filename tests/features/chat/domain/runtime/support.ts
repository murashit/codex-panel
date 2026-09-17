import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/runtime/catalog";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../../src/domain/runtime/settings";
import { unchangedCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { RuntimeSnapshot } from "../../../../../src/features/chat/domain/runtime/snapshot";

interface RuntimeSnapshotPatch extends Partial<Omit<RuntimeSnapshot, "active" | "pending">> {
  active?: Partial<RuntimeSnapshot["active"]>;
  pending?: Partial<RuntimeSnapshot["pending"]>;
}

export function runtimeSnapshot(overrides: RuntimeSnapshotPatch = {}): RuntimeSnapshot {
  const { active, pending, ...snapshotOverrides } = overrides;
  const snapshot: RuntimeSnapshot = {
    runtimeConfig: runtimeConfigFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      service_tier: "flex",
      model_context_window: 100_000,
    }),
    activeThreadId: null,
    active: {
      approvalPolicyKnown: false,
      sandboxPolicyKnown: false,
      permissionProfileKnown: false,
      serviceTierKnown: false,
      model: null,
      reasoningEffort: null,
      collaborationMode: null,
      serviceTier: null,
      approvalsReviewer: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
    },
    pending: {
      model: { kind: "unchanged" },
      reasoningEffort: { kind: "unchanged" },
      permissionProfile: { kind: "unchanged" },
      approvalPolicy: { kind: "unchanged" },
      approvalsReviewer: { kind: "unchanged" },
      collaborationMode: unchangedCollaborationModeIntent(),
      fastMode: { kind: "unchanged" },
    },
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

export function runtimeConfigFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
}

export function modelFixture(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

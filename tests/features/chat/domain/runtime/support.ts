import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../../src/domain/runtime/config";
import {
  resetRuntimeIntentToConfig,
  setRuntimeIntentValue,
  unchangedCollaborationModeIntent,
  unchangedRuntimeIntent,
} from "../../../../../src/features/chat/domain/runtime/intent";
import { resolveRuntimeControls } from "../../../../../src/features/chat/domain/runtime/resolution";
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

function runtimeControls(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot = snapshotConfig(snapshot)) {
  return resolveRuntimeControls(snapshot, config);
}

export function currentModel(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).model.effective;
}

export function currentReasoningEffort(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).reasoningEffort.effective;
}

export function currentServiceTier(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).serviceTier.effective;
}

export function autoReviewActive(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): boolean {
  return runtimeControls(snapshot, config).autoReview.active;
}

export function fastModeActive(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): boolean {
  return runtimeControls(snapshot, config).fastMode.active;
}

export function fastRuntimeServiceTierRequestValue(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string {
  return runtimeControls(snapshot, config).fastMode.serviceTierRequestValue;
}

export function supportedReasoningEfforts(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): readonly string[] {
  return runtimeControls(snapshot, config).supportedReasoningEfforts;
}

export function modelPendingIntentCases() {
  return [
    { name: "unchanged", intent: unchangedRuntimeIntent<string>() },
    { name: "set", intent: setRuntimeIntentValue("gpt-pending") },
    { name: "resetToConfig", intent: resetRuntimeIntentToConfig<string>() },
  ] as const;
}

export function runtimeLayerCase(configured: string | null, active: string | null, pending: string): string {
  return `configured=${configured ?? "none"} active=${active ?? "none"} pending=${pending}`;
}

export function runtimeConfigFixture(config: Record<string, unknown>, layers: ConfigReadResult["layers"] = null): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers,
  });
}

export function configLayer(config: Record<string, unknown>, profile: string | null): NonNullable<ConfigReadResult["layers"]>[number] {
  return {
    name: { type: "user", file: "/home/me/.codex/config.toml", profile },
    version: "1",
    config: config as NonNullable<ConfigReadResult["layers"]>[number]["config"],
    disabledReason: null,
  };
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

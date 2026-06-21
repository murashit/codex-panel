import { describe, expect, it } from "vitest";

import { runtimeConfigSnapshotFromAppServerConfig, type ConfigReadResult } from "../../src/app-server/protocol/runtime-config";
import type { RuntimeConfigSnapshot } from "../../src/domain/runtime/config";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../src/features/chat/application/runtime/settings-actions";
import { compactReasoningEffortLabel } from "../../src/features/chat/presentation/runtime/messages";
import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  fastModeActive,
  fastRuntimeServiceTierRequestValue,
  runtimeConfigOrDefault,
  supportedReasoningEfforts,
} from "../../src/features/chat/domain/runtime/effective";
import type { RuntimeSnapshot } from "../../src/features/chat/domain/runtime/snapshot";
import { resetRuntimeSettingToConfig, setPendingRuntimeSetting } from "../../src/features/chat/domain/runtime/pending-settings";
import {
  pendingRuntimeSettingsPatch,
  serviceTierRequestForThreadStart,
} from "../../src/features/chat/application/runtime/thread-settings-update";
import { contextSummary, rateLimitSummary } from "../../src/features/chat/presentation/runtime/status";

describe("runtime settings", () => {
  it("formats runtime override messages", () => {
    expect(modelOverrideMessage("gpt-5.5")).toBe("Model set to gpt-5.5 for subsequent turns.");
    expect(modelOverrideMessage(null)).toBe("Model reset to default for subsequent turns.");
    expect(reasoningEffortOverrideMessage("low")).toBe("Reasoning effort set to low for subsequent turns.");
    expect(reasoningEffortOverrideMessage(null)).toBe("Reasoning effort reset to default for subsequent turns.");
  });

  it("formats compact runtime labels", () => {
    expect(compactReasoningEffortLabel("minimal")).toBe("min");
    expect(compactReasoningEffortLabel("high")).toBe("high");
    expect(compactReasoningEffortLabel(null)).toBe("default");
  });

  it("keeps runtime defaults, resets, and collaboration mode semantics distinct", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: resetRuntimeSettingToConfig(),
      requestedReasoningEffort: resetRuntimeSettingToConfig(),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5.5");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("high");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: null, effort: null },
      collaborationModeWarning: null,
    });
  });

  it("uses explicit runtime overrides as current values and settings payload values", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: setPendingRuntimeSetting("gpt-5.4"),
      requestedReasoningEffort: setPendingRuntimeSetting("low"),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5.4");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("low");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: "gpt-5.4", effort: "low" },
      collaborationModeWarning: null,
    });
  });

  it("treats unreported thread collaboration mode as default without losing the unknown state", () => {
    const snapshot = runtimeSnapshot({ activeCollaborationMode: null, selectedCollaborationMode: "default" });

    expect(snapshot.activeCollaborationMode).toBeNull();
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toEqual({
      update: {},
      collaborationModeWarning: null,
    });

    expect(snapshot.selectedCollaborationMode).toBe("default");
  });

  it("keeps model reset tied to config when active thread model differs", () => {
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5-active",
      requestedModel: resetRuntimeSettingToConfig(),
      runtimeConfig: runtimeConfigFixture({
        model_reasoning_effort: "high",
        service_tier: "flex",
        model_context_window: 100_000,
      }),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: null },
      collaborationModeWarning: null,
    });
  });

  it("builds the Plan collaboration mode payload from selected runtime settings", () => {
    const snapshot = runtimeSnapshot({
      selectedCollaborationMode: "plan",
      requestedModel: setPendingRuntimeSetting("gpt-5.5"),
      requestedReasoningEffort: setPendingRuntimeSetting("high"),
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoningEffort: "high",
            developerInstructions: null,
          },
        },
      },
      collaborationModeWarning: null,
    });
  });

  it("uses the explicit config for collaboration mode thread settings", () => {
    const snapshot = runtimeSnapshot({
      selectedCollaborationMode: "plan",
      runtimeConfig: runtimeConfigFixture({
        model: "snapshot-model",
        model_reasoning_effort: "low",
      }),
    });
    const explicitConfig = runtimeConfigFixture({
      model: "explicit-model",
      model_reasoning_effort: "high",
    });

    expect(pendingRuntimeSettingsPatch(snapshot, explicitConfig)).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "explicit-model",
            reasoningEffort: "high",
            developerInstructions: null,
          },
        },
      },
      collaborationModeWarning: null,
    });
  });

  it("keeps collaboration mode settings separate from reviewer and direct runtime overrides", () => {
    const reviewerSnapshot = runtimeSnapshot({
      selectedCollaborationMode: "plan",
      requestedApprovalsReviewer: setPendingRuntimeSetting("auto_review"),
    });
    const activeRuntimeSnapshot = runtimeSnapshot({
      selectedCollaborationMode: "plan",
      activeModel: "gpt-5-active",
      activeServiceTier: "fast",
      runtimeConfig: runtimeConfigFixture({}),
    });

    expect(pendingRuntimeSettingsPatch(reviewerSnapshot, snapshotConfig(reviewerSnapshot))).toMatchObject({
      update: {
        approvalsReviewer: "auto_review",
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5.5", reasoningEffort: "high" },
        },
      },
    });
    expect(
      pendingRuntimeSettingsPatch(reviewerSnapshot, snapshotConfig(reviewerSnapshot)).update.collaborationMode?.settings,
    ).not.toHaveProperty("approvalsReviewer");
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot))).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5-active" },
        },
      },
    });
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot)).update).not.toHaveProperty("model");
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot)).update).not.toHaveProperty("effort");
  });

  it("resolves auto-review mode from requested, active, then effective config", () => {
    const requested = runtimeSnapshot({
      requestedApprovalsReviewer: setPendingRuntimeSetting("user"),
      activeApprovalsReviewer: "auto_review",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const active = runtimeSnapshot({
      activeApprovalsReviewer: "user",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });

    expect(autoReviewActive(requested, snapshotConfig(requested))).toBe(false);
    expect(autoReviewActive(active, snapshotConfig(active))).toBe(false);
    expect(autoReviewActive(configured, snapshotConfig(configured))).toBe(true);
  });

  it("uses the active reviewer before configured reviewer", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "user",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("treats guardian subagent reviewer as active auto-review", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "guardian_subagent",
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
  });

  it("uses requested reviewer above active and configured reviewers", () => {
    const snapshot = runtimeSnapshot({
      requestedApprovalsReviewer: setPendingRuntimeSetting("user"),
      activeApprovalsReviewer: "user",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("uses effective approval reviewer values and reports selected profile metadata", () => {
    const runtimeConfig = runtimeConfigFixture({ approvals_reviewer: "auto_review" }, [
      configLayer({}, null),
      configLayer({ approvals_reviewer: "auto_review" }, "auto"),
    ]);
    const snapshot = runtimeSnapshot({
      runtimeConfig,
    });

    expect(runtimeConfigOrDefault(runtimeConfig).profile).toBe("auto");
    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
  });

  it("uses effective model, effort, and fast mode config values", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture(
        {
          model: "gpt-profile",
          model_reasoning_effort: "high",
          service_tier: "fast",
        },
        [
          configLayer({}, null),
          configLayer({ model: "gpt-profile", model_reasoning_effort: "high", service_tier: "fast" }, "fast-profile"),
        ],
      ),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-profile");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("high");
    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("fast");
  });

  it("uses active service tier before configured service tier", () => {
    const snapshot = runtimeSnapshot({
      activeServiceTier: "flex",
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("treats the catalog Fast service tier id as fast mode while preserving the id", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    // This mirrors Codex app-server 0.134.0 model/list: Fast is named "Fast" but its id is "priority".
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5.5",
      activeServiceTier: "priority",
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("priority");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(fastRuntimeServiceTierRequestValue(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("treats the Codex 0.134.0 reported default tier after clearing Fast as fast mode off", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5.5",
      activeServiceTier: "default",
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("default");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("uses requested service tier above active and configured service tiers", () => {
    const snapshot = runtimeSnapshot({
      requestedServiceTier: setPendingRuntimeSetting("off"),
      activeServiceTier: "flex",
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("resolves requested approval reviewer without adding it to turn runtime settings", () => {
    const snapshot = runtimeSnapshot({ requestedApprovalsReviewer: setPendingRuntimeSetting("auto_review") });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { approvalsReviewer: "auto_review" },
    });
  });

  it("treats active thread runtime as display state without persisting it into turn overrides", () => {
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5-active",
      activeServiceTier: "fast",
      runtimeConfig: runtimeConfigFixture({}),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5-active");
    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("model");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("effort");
  });

  it("uses the explicit config when finding supported reasoning efforts", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: resetRuntimeSettingToConfig(),
      runtimeConfig: runtimeConfigFixture({ model: "snapshot-model" }),
      availableModels: [
        { ...modelFixture("snapshot-model"), supportedReasoningEfforts: ["low"] },
        { ...modelFixture("explicit-model"), supportedReasoningEfforts: ["high"] },
      ],
    });
    const explicitConfig = runtimeConfigFixture({ model: "explicit-model" });

    expect(supportedReasoningEfforts(snapshot, explicitConfig)).toEqual(["high"]);
  });

  it("summarizes service tier and context meter state from one runtime snapshot", () => {
    const snapshot = runtimeSnapshot({ requestedServiceTier: setPendingRuntimeSetting("fast"), activeThreadId: "thread" });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(contextSummary(snapshot)).toMatchObject({
      label: "Context 0%",
      title: "Context: 0 / 100,000 (0%). No turns in this thread yet.",
      percent: 0,
      level: "ok",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          tokenUsage: {
            last: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 1250 },
            total: { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 100, totalTokens: 2600 },
            modelContextWindow: 100_000,
          },
        }),
      ),
    ).toMatchObject({
      title: "Context: 1,000 / 100,000 (1%). Last request: 1,000 input, 200 output, 50 reasoning. Total: 2,600 tokens.",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          hasThreadTurns: true,
        }),
      ),
    ).toMatchObject({
      label: "Context unknown",
      percent: null,
    });
  });

  it("serializes explicit fast off as a null service tier request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      requestedServiceTier: setPendingRuntimeSetting("off"),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes service tier reset for thread start as an explicit null request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      requestedServiceTier: resetRuntimeSettingToConfig(),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes requested fast mode using the catalog Fast service tier id", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    const snapshot = runtimeSnapshot({
      requestedServiceTier: setPendingRuntimeSetting("fast"),
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("omits service tier when neither config nor override selects one", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({}) });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeUndefined();
  });

  it("passes through configured non-fast service tier ids", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({ service_tier: "flex" }) });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("flex");
  });

  it("summarizes Codex usage limits independently from context usage", () => {
    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 72.4, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "5h", value: "72%", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: 5 }],
      level: "warn",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: null,
            primary: { usedPercent: 95, windowDurationMins: null, resetsAt: null },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: "rate_limit_reached",
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [{ percent: 95, resetLabel: null }],
      level: "danger",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: null },
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [
        { label: "5h", value: "15%", meterDivisions: 5 },
        { label: "1w", value: "38%", meterDivisions: 7 },
      ],
      level: "ok",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_800_000_001_000,
      ),
    ).toMatchObject({
      rows: [{ resetLabel: "reset due" }],
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: null,
            secondary: null,
            individualLimit: { limit: "$100", used: "$72", remainingPercent: 28, resetsAt: 1_800_000_000 },
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "monthly", value: "$72 / $100", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: null }],
      level: "warn",
    });
  });
});

function runtimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    runtimeConfig: runtimeConfigFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      service_tier: "flex",
      model_context_window: 100_000,
    }),
    activeThreadId: null,
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: null,
    activeServiceTier: null,
    activeApprovalPolicy: null,
    activeApprovalsReviewer: null,
    activePermissionProfile: null,
    requestedModel: { kind: "unchanged" },
    requestedReasoningEffort: { kind: "unchanged" },
    requestedApprovalsReviewer: { kind: "unchanged" },
    selectedCollaborationMode: "default",
    requestedServiceTier: { kind: "unchanged" },
    tokenUsage: null,
    rateLimit: null,
    hasThreadTurns: false,
    availableModels: [],
    ...overrides,
  };
}

function snapshotConfig(snapshot: RuntimeSnapshot): RuntimeConfigSnapshot {
  return runtimeConfigOrDefault(snapshot.runtimeConfig);
}

function runtimeConfigFixture(config: Record<string, unknown>, layers: ConfigReadResult["layers"] = null): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers,
  });
}

function configLayer(config: Record<string, unknown>, profile: string | null): NonNullable<ConfigReadResult["layers"]>[number] {
  return {
    name: { type: "user", file: "/home/me/.codex/config.toml", profile },
    version: "1",
    config: config as NonNullable<ConfigReadResult["layers"]>[number]["config"],
    disabledReason: null,
  };
}

function modelFixture(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

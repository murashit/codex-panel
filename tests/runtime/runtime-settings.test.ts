import { describe, expect, it } from "vitest";

import {
  runtimeConfigSnapshotFromAppServerConfig,
  type ConfigReadResult,
  type RuntimeConfigSnapshot,
} from "../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import {
  compactModelLabel,
  compactReasoningEffortLabel,
  modelOverrideMessage,
  reasoningEffortOverrideMessage,
} from "../../src/features/chat/runtime/settings-copy";
import { parseModelOverride, parseReasoningEffortOverride } from "../../src/features/chat/conversation/turns/runtime-setting-commands";
import {
  autoReviewActive,
  currentApprovalsReviewer,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  fastModeActive,
  fastRuntimeServiceTierRequestValue,
  fastModeLabel,
  runtimeConfigOrDefault,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../src/features/chat/runtime/effective";
import type { RuntimeSnapshot } from "../../src/features/chat/runtime/snapshot";
import { resetRuntimeSettingToConfig, setPendingRuntimeSetting } from "../../src/features/chat/runtime/pending-settings";
import {
  pendingRuntimeSettingsPatch,
  requestedTurnCollaborationModeSettings,
  serviceTierRequestForThreadStart,
} from "../../src/features/chat/runtime/thread-settings-update";
import { contextSummary, runtimeConfigSections, rateLimitSummary } from "../../src/features/chat/display/status/runtime";

describe("runtime settings", () => {
  it("parses model overrides", () => {
    expect(parseModelOverride("gpt-5.5")).toBe("gpt-5.5");
    expect(parseModelOverride(" default ")).toBeNull();
    expect(parseModelOverride("")).toBeUndefined();
  });

  it("parses reasoning effort overrides", () => {
    expect(parseReasoningEffortOverride("high")).toBe("high");
    expect(parseReasoningEffortOverride("default")).toBeNull();
    expect(parseReasoningEffortOverride("extreme")).toBe("extreme");
    expect(parseReasoningEffortOverride("CaseSensitive")).toBe("CaseSensitive");
  });

  it("formats runtime override messages", () => {
    expect(modelOverrideMessage("gpt-5.5")).toBe("Model set to gpt-5.5 for subsequent turns.");
    expect(modelOverrideMessage(null)).toBe("Model reset to default for subsequent turns.");
    expect(reasoningEffortOverrideMessage("low")).toBe("Reasoning effort set to low for subsequent turns.");
    expect(reasoningEffortOverrideMessage(null)).toBe("Reasoning effort reset to default for subsequent turns.");
  });

  it("formats compact runtime labels", () => {
    expect(compactModelLabel("gpt-5.5")).toBe("5.5");
    expect(compactModelLabel("custom-model")).toBe("custom-model");
    expect(compactModelLabel(null)).toBe("default");
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
    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).toMatchObject({
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5.5", reasoningEffort: "high" },
      },
    });
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

    const runtimeRows = Object.fromEntries(
      runtimeConfigSections(snapshot, "/vault")
        .find((section) => section.title === "Runtime")
        ?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    expect(runtimeRows["effective mode"]).toBe("(not reported)");
    expect(runtimeRows["requested mode"]).toBe("(none)");
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

    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).toEqual({
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoningEffort: "high",
          developerInstructions: null,
        },
      },
      warning: null,
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

    expect(requestedTurnCollaborationModeSettings(snapshot, explicitConfig)).toEqual({
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "explicit-model",
          reasoningEffort: "high",
          developerInstructions: null,
        },
      },
      warning: null,
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

  it("resolves approval reviewer from requested, active, then effective config", () => {
    const requested = runtimeSnapshot({
      requestedApprovalsReviewer: setPendingRuntimeSetting("user"),
      activeApprovalsReviewer: "auto_review",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const active = runtimeSnapshot({
      activeApprovalsReviewer: "auto_review",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });

    expect(currentApprovalsReviewer(requested, snapshotConfig(requested))).toBe("user");
    expect(currentApprovalsReviewer(active, snapshotConfig(active))).toBe("auto_review");
    expect(currentApprovalsReviewer(configured, snapshotConfig(configured))).toBe("guardian_subagent");
  });

  it("uses the active reviewer before configured reviewer", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "user",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(currentApprovalsReviewer(snapshot, snapshotConfig(snapshot))).toBe("user");
    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("treats guardian subagent reviewer as active auto-review", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "guardian_subagent",
    });

    expect(currentApprovalsReviewer(snapshot, snapshotConfig(snapshot))).toBe("guardian_subagent");
    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
  });

  it("uses requested reviewer above active and configured reviewers", () => {
    const snapshot = runtimeSnapshot({
      requestedApprovalsReviewer: setPendingRuntimeSetting("user"),
      activeApprovalsReviewer: "user",
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(currentApprovalsReviewer(snapshot, snapshotConfig(snapshot))).toBe("user");
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
    expect(currentApprovalsReviewer(snapshot, snapshotConfig(snapshot))).toBe("auto_review");
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
    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("on");
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("fast");
  });

  it("uses active service tier before configured service tier", () => {
    const snapshot = runtimeSnapshot({
      activeServiceTier: "flex",
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("off");
  });

  it("treats the catalog Fast service tier id as fast mode while preserving the id", () => {
    const model = modelFixture("gpt-5.5");
    // This mirrors Codex app-server 0.134.0 model/list: Fast is named "Fast" but its id is "priority".
    model.serviceTiers = [{ id: "priority", name: "Fast" }];
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5.5",
      activeServiceTier: "priority",
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("priority");
    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("priority");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("on");
    expect(fastRuntimeServiceTierRequestValue(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("treats the Codex 0.134.0 reported default tier after clearing Fast as fast mode off", () => {
    const model = modelFixture("gpt-5.5");
    model.serviceTiers = [{ id: "priority", name: "Fast" }];
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5.5",
      activeServiceTier: "default",
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("default");
    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("default");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("off");
  });

  it("uses requested service tier above active and configured service tiers", () => {
    const snapshot = runtimeSnapshot({
      requestedServiceTier: setPendingRuntimeSetting("off"),
      activeServiceTier: "flex",
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("off");
  });

  it("resolves requested approval reviewer without adding it to turn runtime settings", () => {
    const snapshot = runtimeSnapshot({ requestedApprovalsReviewer: setPendingRuntimeSetting("auto_review") });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(currentApprovalsReviewer(snapshot, snapshotConfig(snapshot))).toBe("auto_review");
    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).not.toHaveProperty("approvalsReviewer");
  });

  it("treats active thread runtime as display state without persisting it into turn overrides", () => {
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5-active",
      activeServiceTier: "fast",
      runtimeConfig: runtimeConfigFixture({}),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5-active");
    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).toMatchObject({
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5-active" },
      },
    });
    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).not.toHaveProperty("model");
    expect(requestedTurnCollaborationModeSettings(snapshot, snapshotConfig(snapshot))).not.toHaveProperty("effort");
  });

  it("separates effective runtime, config defaults, and pending changes in status details", () => {
    const sections = runtimeConfigSections(
      runtimeSnapshot({
        activeModel: "gpt-5-active",
        activeReasoningEffort: "low",
        activeCollaborationMode: "plan",
        selectedCollaborationMode: "plan",
        requestedModel: setPendingRuntimeSetting("gpt-5-pending"),
      }),
      "/vault",
    );
    const runtimeRows = Object.fromEntries(
      sections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(runtimeRows).toMatchObject({
      "effective model": "gpt-5-pending",
      "configured model": "gpt-5.5",
      "thread model": "gpt-5-active",
      "requested model": "gpt-5-pending",
      "effective effort": "low",
      "configured effort": "high",
      "thread effort": "low",
      "requested effort": "(none)",
      "effective mode": "Plan",
      "requested mode": "(none)",
      "configured service tier": "flex",
      "thread service tier": "(not reported)",
      "requested service tier": "(none)",
    });

    const resetSections = runtimeConfigSections(
      runtimeSnapshot({
        requestedReasoningEffort: resetRuntimeSettingToConfig(),
      }),
      "/vault",
    );
    const resetRuntimeRows = Object.fromEntries(
      resetSections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    expect(resetRuntimeRows["requested effort"]).toBe("(reset to config)");
  });

  it("labels unset config values as Codex defaults when no concrete value is reported", () => {
    const sections = runtimeConfigSections(
      runtimeSnapshot({
        runtimeConfig: runtimeConfigFixture({}),
      }),
      "/vault",
    );
    const scopeRows = Object.fromEntries(
      sections.find((section) => section.title === "Scope")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    const runtimeRows = Object.fromEntries(
      sections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    const policyRows = Object.fromEntries(
      sections.find((section) => section.title === "Policy")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(scopeRows["model provider"]).toBe("(Codex default)");
    expect(runtimeRows).toMatchObject({
      "effective model": "(Codex default)",
      "configured model": "(not reported)",
      "thread model": "(not reported)",
      "requested model": "(none)",
      "configured service tier": "(Codex default)",
      "thread service tier": "(not reported)",
      "requested service tier": "(none)",
      "fast mode": "Codex default",
    });
    expect(policyRows).toMatchObject({
      "effective approval": "(Codex default)",
      "configured approval": "(Codex default)",
      "thread approval": "(not reported)",
      "active permissions": "(not reported)",
      "configured reviewer": "(Codex default)",
      sandbox: "(Codex default)",
      "web search": "(Codex default)",
    });
  });

  it("uses catalog default reasoning efforts from model metadata", () => {
    const model = { ...modelFixture("gpt-catalog-default"), isDefault: true, defaultReasoningEffort: "extreme" };
    const sections = runtimeConfigSections(
      runtimeSnapshot({
        runtimeConfig: runtimeConfigFixture({}),
        availableModels: [model],
      }),
      "/vault",
    );
    const runtimeRows = Object.fromEntries(
      sections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(runtimeRows["configured model"]).toBe("gpt-catalog-default");
    expect(runtimeRows["configured effort"]).toBe("extreme");
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

  it("shows effective profile runtime and policy values in status details", () => {
    const profileConfig = {
      model: "gpt-profile",
      model_provider: "profile-provider",
      model_reasoning_effort: "high",
      model_reasoning_summary: "detailed",
      model_verbosity: "high",
      approval_policy: "never",
      approvals_reviewer: "auto_review",
      web_search: "live",
      service_tier: "fast",
    };
    const sections = runtimeConfigSections(
      runtimeSnapshot({
        runtimeConfig: runtimeConfigFixture(profileConfig, [configLayer({}, null), configLayer(profileConfig, "auto")]),
      }),
      "/vault",
    );
    const scopeRows = Object.fromEntries(
      sections.find((section) => section.title === "Scope")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    const runtimeRows = Object.fromEntries(
      sections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    const policyRows = Object.fromEntries(
      sections.find((section) => section.title === "Policy")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(scopeRows["profile"]).toBe("auto");
    expect(scopeRows["model provider"]).toBe("profile-provider");
    expect(runtimeRows).toMatchObject({
      "effective model": "gpt-profile",
      "configured model": "gpt-profile",
      "thread model": "(not reported)",
      "requested model": "(none)",
      "effective effort": "high",
      "configured effort": "high",
      "thread effort": "(not reported)",
      "requested effort": "(none)",
      "reasoning summary": "detailed",
      verbosity: "high",
      "effective service tier": "fast",
      "configured service tier": "fast",
      "thread service tier": "(not reported)",
      "requested service tier": "(none)",
      "fast mode": "on",
    });
    expect(policyRows["effective approval"]).toBe("never");
    expect(policyRows["configured approval"]).toBe("never");
    expect(policyRows["thread approval"]).toBe("(not reported)");
    expect(policyRows["active permissions"]).toBe("(not reported)");
    expect(policyRows["effective reviewer"]).toBe("auto_review");
    expect(policyRows["auto-review"]).toBe("on");
    expect(policyRows["configured reviewer"]).toBe("auto_review");
    expect(policyRows["thread reviewer"]).toBe("(not reported)");
    expect(policyRows["requested reviewer"]).toBe("(none)");
    expect(policyRows["web search"]).toBe("live");
  });

  it("shows active and configured reviewer inputs in status details", () => {
    const sections = runtimeConfigSections(
      runtimeSnapshot({
        activeApprovalsReviewer: "guardian_subagent",
        activeApprovalPolicy: "never",
        activePermissionProfile: { id: ":workspace", extends: ":default" },
        runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
      }),
      "/vault",
    );
    const policyRows = Object.fromEntries(
      sections.find((section) => section.title === "Policy")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(policyRows).toMatchObject({
      "effective approval": "never",
      "thread approval": "never",
      "active permissions": ":workspace extends :default",
      "effective reviewer": "guardian_subagent",
      "auto-review": "on",
      "configured reviewer": "auto_review",
      "thread reviewer": "guardian_subagent",
    });
  });

  it("summarizes service tier and context meter state from one runtime snapshot", () => {
    const snapshot = runtimeSnapshot({ requestedServiceTier: setPendingRuntimeSetting("fast"), activeThreadId: "thread" });

    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("on");
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

    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("(Codex default)");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("off");
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes service tier reset for thread start as an explicit null request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      requestedServiceTier: resetRuntimeSettingToConfig(),
    });

    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("on");
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes requested fast mode using the catalog Fast service tier id", () => {
    const model = modelFixture("gpt-5.5");
    model.serviceTiers = [{ id: "priority", name: "Fast" }];
    const snapshot = runtimeSnapshot({
      requestedServiceTier: setPendingRuntimeSetting("fast"),
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("on");
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("omits service tier when neither config nor override selects one", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({}) });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeUndefined();
  });

  it("passes through configured non-fast service tier ids", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({ service_tier: "flex" }) });

    expect(serviceTierLabel(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeLabel(snapshot, snapshotConfig(snapshot))).toBe("off");
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

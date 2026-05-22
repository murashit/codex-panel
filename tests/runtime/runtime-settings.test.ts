import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "../../src/generated/app-server/v2/ConfigReadResponse";
import {
  compactContextLabel,
  compactModelLabel,
  compactReasoningEffortLabel,
  modelOverrideMessage,
  parseModelOverride,
  parseReasoningEffortOverride,
  reasoningEffortOverrideMessage,
} from "../../src/runtime/settings";
import {
  autoReviewActive,
  currentApprovalsReviewer,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  fastModeLabel,
  requestedOrConfiguredServiceTier,
  requestedTurnRuntimeSettings,
  resetRuntimeOverride,
  runtimeOverridePayload,
  setRuntimeOverride,
  serviceTierLabel,
  type RuntimeSnapshot,
} from "../../src/runtime/state";
import { readRuntimeConfig } from "../../src/runtime/config";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../../src/runtime/view";

describe("runtime settings", () => {
  it("parses model overrides", () => {
    expect(parseModelOverride("gpt-5.5")).toBe("gpt-5.5");
    expect(parseModelOverride(" default ")).toBeNull();
    expect(parseModelOverride("")).toBeUndefined();
  });

  it("parses reasoning effort overrides", () => {
    expect(parseReasoningEffortOverride("high")).toBe("high");
    expect(parseReasoningEffortOverride("default")).toBeNull();
    expect(parseReasoningEffortOverride("extreme")).toBeUndefined();
  });

  it("formats runtime override messages", () => {
    expect(modelOverrideMessage("gpt-5.5")).toBe("Model set to gpt-5.5 for subsequent turns.");
    expect(modelOverrideMessage(null)).toBe("Model reset to default for subsequent turns.");
    expect(reasoningEffortOverrideMessage("low")).toBe("Effort set to low for subsequent turns.");
    expect(reasoningEffortOverrideMessage(null)).toBe("Effort reset to default for subsequent turns.");
  });

  it("formats compact runtime labels", () => {
    expect(compactModelLabel("gpt-5.5")).toBe("5.5");
    expect(compactModelLabel("custom-model")).toBe("custom-model");
    expect(compactModelLabel(null)).toBe("default");
    expect(compactReasoningEffortLabel("minimal")).toBe("min");
    expect(compactReasoningEffortLabel("high")).toBe("high");
    expect(compactReasoningEffortLabel(null)).toBe("default");
  });

  it("formats compact context labels", () => {
    expect(compactContextLabel(42, "Context 42%")).toBe("42%");
    expect(compactContextLabel(null, "Context waiting")).toBe("wait");
    expect(compactContextLabel(null, "Context unknown")).toBe("?");
    expect(compactContextLabel(null, "1.2K tokens")).toBe("1.2K tokens");
  });

  it("keeps runtime defaults, resets, and collaboration mode semantics distinct", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: resetRuntimeOverride(),
      requestedReasoningEffort: resetRuntimeOverride(),
    });

    expect(currentModel(snapshot)).toBe("gpt-5.5");
    expect(currentReasoningEffort(snapshot)).toBe("high");
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5.5", reasoning_effort: "high" },
      },
    });
    expect(runtimeOverridePayload(snapshot.requestedModel)).toBeNull();
    expect(runtimeOverridePayload(snapshot.requestedReasoningEffort)).toBeNull();
  });

  it("uses explicit runtime overrides as current values and settings payload values", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: setRuntimeOverride("gpt-5.4"),
      requestedReasoningEffort: setRuntimeOverride("low"),
    });

    expect(currentModel(snapshot)).toBe("gpt-5.4");
    expect(currentReasoningEffort(snapshot)).toBe("low");
    expect(runtimeOverridePayload(snapshot.requestedModel)).toBe("gpt-5.4");
    expect(runtimeOverridePayload(snapshot.requestedReasoningEffort)).toBe("low");
  });

  it("resolves approval reviewer from requested, active, then effective config", () => {
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          requestedApprovalsReviewer: "user",
          activeApprovalsReviewer: "auto_review",
          effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "guardian_subagent" }),
        }),
      ),
    ).toBe("user");
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          activeApprovalsReviewer: "auto_review",
          effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "guardian_subagent" }),
        }),
      ),
    ).toBe("auto_review");
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "guardian_subagent" }),
        }),
      ),
    ).toBe("guardian_subagent");
  });

  it("uses the active reviewer before configured reviewer", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "user",
      effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(currentApprovalsReviewer(snapshot)).toBe("user");
    expect(autoReviewActive(snapshot)).toBe(false);
  });

  it("uses raw config layers when typed config omits approval reviewer", () => {
    const effectiveConfig = effectiveConfigFixture({ approvals_reviewer: null }, [
      {
        name: { type: "user", file: "/home/me/.codex/config.toml", profile: null },
        version: "1",
        config: { approvals_reviewer: "auto_review" },
        disabledReason: null,
      },
    ]);
    const projection = readRuntimeConfig(effectiveConfig);
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "user",
      effectiveConfig,
    });

    expect(projection.approvalsReviewer).toBe("auto_review");
    expect(autoReviewActive(snapshot, projection)).toBe(false);
  });

  it("treats guardian subagent reviewer as active auto-review", () => {
    const snapshot = runtimeSnapshot({
      activeApprovalsReviewer: "guardian_subagent",
    });

    expect(currentApprovalsReviewer(snapshot)).toBe("guardian_subagent");
    expect(autoReviewActive(snapshot)).toBe(true);
  });

  it("uses requested reviewer above active and configured reviewers", () => {
    const snapshot = runtimeSnapshot({
      requestedApprovalsReviewer: "user",
      activeApprovalsReviewer: "user",
      effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(currentApprovalsReviewer(snapshot)).toBe("user");
    expect(autoReviewActive(snapshot)).toBe(false);
  });

  it("resolves approval reviewer from the selected config profile", () => {
    const snapshot = runtimeSnapshot({
      effectiveConfig: effectiveConfigFixture({
        approvals_reviewer: "user",
        profile: "auto",
        profiles: {
          auto: { approvals_reviewer: "auto_review" },
        },
      }),
    });

    expect(currentApprovalsReviewer(snapshot)).toBe("auto_review");
    expect(autoReviewActive(snapshot)).toBe(true);
  });

  it("resolves model, effort, and fast mode from the selected config profile", () => {
    const snapshot = runtimeSnapshot({
      effectiveConfig: effectiveConfigFixture({
        model: "gpt-root",
        model_reasoning_effort: "low",
        service_tier: "standard",
        profile: "fast-profile",
        profiles: {
          "fast-profile": {
            model: "gpt-profile",
            model_reasoning_effort: "high",
            service_tier: "fast",
          },
        },
      }),
    });

    expect(currentModel(snapshot)).toBe("gpt-profile");
    expect(currentReasoningEffort(snapshot)).toBe("high");
    expect(currentServiceTier(snapshot)).toBe("fast");
    expect(serviceTierLabel(snapshot)).toBe("fast");
    expect(fastModeLabel(snapshot)).toBe("on");
    expect(requestedOrConfiguredServiceTier(snapshot)).toBe("fast");
  });

  it("uses active service tier before configured service tier", () => {
    const snapshot = runtimeSnapshot({
      activeServiceTier: "standard",
      effectiveConfig: effectiveConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot)).toBe("standard");
    expect(fastModeLabel(snapshot)).toBe("off");
  });

  it("uses requested service tier above active and configured service tiers", () => {
    const snapshot = runtimeSnapshot({
      requestedServiceTier: "standard",
      activeServiceTier: "standard",
      effectiveConfig: effectiveConfigFixture({ service_tier: "fast" }),
    });

    expect(currentServiceTier(snapshot)).toBe("standard");
    expect(fastModeLabel(snapshot)).toBe("off");
  });

  it("resolves requested approval reviewer without adding it to turn runtime settings", () => {
    const snapshot = runtimeSnapshot({ requestedApprovalsReviewer: "auto_review" });

    expect(autoReviewActive(snapshot)).toBe(true);
    expect(currentApprovalsReviewer(snapshot)).toBe("auto_review");
    expect(requestedTurnRuntimeSettings(snapshot)).not.toHaveProperty("approvalsReviewer");
  });

  it("treats active thread runtime as display state without persisting it into turn overrides", () => {
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5-active",
      activeServiceTier: "fast",
      effectiveConfig: effectiveConfigFixture({}),
    });

    expect(currentModel(snapshot)).toBe("gpt-5-active");
    expect(currentServiceTier(snapshot)).toBe("fast");
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5-active" },
      },
    });
    expect(requestedTurnRuntimeSettings(snapshot)).not.toHaveProperty("model");
    expect(requestedTurnRuntimeSettings(snapshot)).not.toHaveProperty("effort");
  });

  it("separates effective runtime, config defaults, and pending changes in status details", () => {
    const sections = effectiveConfigSections(
      runtimeSnapshot({
        activeModel: "gpt-5-active",
        activeReasoningEffort: "low",
        activeCollaborationMode: "plan",
        requestedCollaborationMode: "plan",
        requestedModel: setRuntimeOverride("gpt-5-pending"),
      }),
      "/vault",
    );
    const runtimeRows = Object.fromEntries(
      sections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(runtimeRows).toMatchObject({
      model: "gpt-5-pending",
      "config model": "gpt-5.5",
      "model change": "gpt-5-pending",
      effort: "low",
      "config effort": "high",
      "effort change": "(none)",
      mode: "Plan",
      "mode change": "(none)",
      "config service tier": "standard",
      "active service tier": "(not reported)",
    });

    const resetSections = effectiveConfigSections(
      runtimeSnapshot({
        requestedReasoningEffort: resetRuntimeOverride(),
      }),
      "/vault",
    );
    const resetRuntimeRows = Object.fromEntries(
      resetSections.find((section) => section.title === "Runtime")?.rows.map((row) => [row.key, row.value]) ?? [],
    );
    expect(resetRuntimeRows["effort change"]).toBe("(reset to config)");
  });

  it("shows selected profile runtime and policy values in status details", () => {
    const sections = effectiveConfigSections(
      runtimeSnapshot({
        effectiveConfig: effectiveConfigFixture({
          model: "gpt-root",
          model_provider: "root-provider",
          model_reasoning_effort: "low",
          model_reasoning_summary: "auto",
          model_verbosity: "low",
          approval_policy: "on-request",
          web_search: "disabled",
          service_tier: "standard",
          profile: "auto",
          profiles: {
            auto: {
              model: "gpt-profile",
              model_provider: "profile-provider",
              model_reasoning_effort: "high",
              model_reasoning_summary: "detailed",
              model_verbosity: "high",
              approval_policy: "never",
              approvals_reviewer: "auto_review",
              web_search: "live",
              service_tier: "fast",
            },
          },
        }),
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

    expect(scopeRows["model provider"]).toBe("profile-provider");
    expect(runtimeRows).toMatchObject({
      model: "gpt-profile",
      "config model": "gpt-profile",
      effort: "high",
      "config effort": "high",
      "reasoning summary": "detailed",
      verbosity: "high",
      "service tier": "fast",
      "config service tier": "fast",
      "active service tier": "(not reported)",
      "fast mode": "on",
    });
    expect(policyRows["approval"]).toBe("never");
    expect(policyRows["reviewer"]).toBe("auto_review");
    expect(policyRows["auto-review"]).toBe("on");
    expect(policyRows["config reviewer"]).toBe("auto_review");
    expect(policyRows["active reviewer"]).toBe("(not reported)");
    expect(policyRows["web search"]).toBe("live");
  });

  it("shows active and configured reviewer inputs in status details", () => {
    const sections = effectiveConfigSections(
      runtimeSnapshot({
        activeApprovalsReviewer: "guardian_subagent",
        effectiveConfig: effectiveConfigFixture({ approvals_reviewer: "auto_review" }),
      }),
      "/vault",
    );
    const policyRows = Object.fromEntries(
      sections.find((section) => section.title === "Policy")?.rows.map((row) => [row.key, row.value]) ?? [],
    );

    expect(policyRows).toMatchObject({
      reviewer: "guardian_subagent",
      "auto-review": "on",
      "config reviewer": "auto_review",
      "active reviewer": "guardian_subagent",
    });
  });

  it("summarizes service tier and context meter state from one runtime snapshot", () => {
    const snapshot = runtimeSnapshot({ requestedServiceTier: "fast", activeThreadId: "thread" });

    expect(serviceTierLabel(snapshot)).toBe("fast");
    expect(fastModeLabel(snapshot)).toBe("on");
    expect(contextSummary(snapshot)).toMatchObject({
      label: "Context 0%",
      percent: 0,
      level: "ok",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          displayItems: [{ id: "u1", kind: "message", role: "user", text: "hi", turnId: "t1" }],
        }),
      ),
    ).toMatchObject({
      label: "Context unknown",
      percent: null,
    });
  });

  it("serializes explicit fast off as a null service tier request", () => {
    const snapshot = runtimeSnapshot({
      effectiveConfig: effectiveConfigFixture({ service_tier: "fast" }),
      requestedServiceTier: "standard",
    });

    expect(serviceTierLabel(snapshot)).toBe("standard");
    expect(fastModeLabel(snapshot)).toBe("off");
    expect(requestedOrConfiguredServiceTier(snapshot)).toBeNull();
  });

  it("omits service tier when neither config nor override selects one", () => {
    expect(requestedOrConfiguredServiceTier(runtimeSnapshot({ effectiveConfig: effectiveConfigFixture({}) }))).toBeUndefined();
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
            credits: null,
            planType: null,
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "5h", value: "72%", resetLabel: "reset in 2h 20m", percent: 72 }],
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
            credits: null,
            planType: null,
            rateLimitReachedType: "rate_limit_reached",
          },
        }),
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
            credits: null,
            planType: null,
            rateLimitReachedType: null,
          },
        }),
      ),
    ).toMatchObject({
      rows: [
        { label: "5h", value: "15%" },
        { label: "1w", value: "38%" },
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
            credits: null,
            planType: null,
            rateLimitReachedType: null,
          },
        }),
        1_800_000_001_000,
      ),
    ).toMatchObject({
      rows: [{ resetLabel: "reset due" }],
    });
  });
});

function runtimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    effectiveConfig: effectiveConfigFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      service_tier: "flex",
      model_context_window: 100_000,
    }),
    activeThreadId: null,
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalsReviewer: null,
    requestedModel: { kind: "default" },
    requestedReasoningEffort: { kind: "default" },
    requestedApprovalsReviewer: null,
    requestedCollaborationMode: "default",
    requestedServiceTier: null,
    tokenUsage: null,
    rateLimit: null,
    displayItems: [],
    availableModels: [],
    ...overrides,
  };
}

function effectiveConfigFixture(config: Record<string, unknown>, layers: ConfigReadResponse["layers"] = null): ConfigReadResponse {
  return {
    config: config as ConfigReadResponse["config"],
    origins: {},
    layers,
  };
}

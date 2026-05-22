import { describe, expect, it } from "vitest";

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
  setRuntimeOverride,
  serviceTierLabel,
  type RuntimeSnapshot,
} from "../../src/runtime/state";
import { contextSummary, rateLimitSummary } from "../../src/runtime/view";

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

  it("keeps runtime defaults, resets, and turn payload semantics distinct", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: resetRuntimeOverride(),
      requestedReasoningEffort: resetRuntimeOverride(),
    });

    expect(currentModel(snapshot)).toBe("gpt-5.5");
    expect(currentReasoningEffort(snapshot)).toBe("high");
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      model: null,
      effort: null,
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5.5", reasoning_effort: "high" },
      },
    });
  });

  it("serializes explicit runtime overrides as turn payload values", () => {
    const snapshot = runtimeSnapshot({
      requestedModel: setRuntimeOverride("gpt-5.4"),
      requestedReasoningEffort: setRuntimeOverride("low"),
    });

    expect(currentModel(snapshot)).toBe("gpt-5.4");
    expect(currentReasoningEffort(snapshot)).toBe("low");
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      model: "gpt-5.4",
      effort: "low",
    });
  });

  it("resolves approval reviewer from requested, active, then effective config", () => {
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          requestedApprovalsReviewer: "user",
          activeApprovalsReviewer: "auto_review",
          effectiveConfig: { config: { approvals_reviewer: "guardian_subagent" } } as unknown as RuntimeSnapshot["effectiveConfig"],
        }),
      ),
    ).toBe("user");
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          activeApprovalsReviewer: "auto_review",
          effectiveConfig: { config: { approvals_reviewer: "guardian_subagent" } } as unknown as RuntimeSnapshot["effectiveConfig"],
        }),
      ),
    ).toBe("auto_review");
    expect(
      currentApprovalsReviewer(
        runtimeSnapshot({
          effectiveConfig: { config: { approvals_reviewer: "guardian_subagent" } } as unknown as RuntimeSnapshot["effectiveConfig"],
        }),
      ),
    ).toBe("guardian_subagent");
  });

  it("serializes requested approval reviewer as a turn override", () => {
    const snapshot = runtimeSnapshot({ requestedApprovalsReviewer: "auto_review" });

    expect(autoReviewActive(snapshot)).toBe(true);
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      approvalsReviewer: "auto_review",
    });
  });

  it("treats active thread runtime as display state without persisting it into turn overrides", () => {
    const snapshot = runtimeSnapshot({
      activeModel: "gpt-5-active",
      activeServiceTier: "fast",
      effectiveConfig: { config: {} } as unknown as RuntimeSnapshot["effectiveConfig"],
    });

    expect(currentModel(snapshot)).toBe("gpt-5-active");
    expect(currentServiceTier(snapshot)).toBe("fast");
    expect(requestedTurnRuntimeSettings(snapshot)).toMatchObject({
      model: undefined,
      effort: undefined,
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5-active" },
      },
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
      effectiveConfig: { config: { service_tier: "fast" } } as unknown as RuntimeSnapshot["effectiveConfig"],
      requestedServiceTier: "standard",
    });

    expect(serviceTierLabel(snapshot)).toBe("standard");
    expect(fastModeLabel(snapshot)).toBe("off");
    expect(requestedOrConfiguredServiceTier(snapshot)).toBeNull();
  });

  it("omits service tier when neither config nor override selects one", () => {
    expect(
      requestedOrConfiguredServiceTier(
        runtimeSnapshot({ effectiveConfig: { config: {} } as unknown as RuntimeSnapshot["effectiveConfig"] }),
      ),
    ).toBeUndefined();
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
    effectiveConfig: {
      config: {
        model: "gpt-5.5",
        model_reasoning_effort: "high",
        service_tier: "flex",
        model_context_window: 100_000,
      },
    } as unknown as RuntimeSnapshot["effectiveConfig"],
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

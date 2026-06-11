import { describe, expect, it } from "vitest";

import { appServerCollaborationMode, applyThreadSettingsValue, type ThreadSettingsUpdate } from "../../src/app-server/thread-settings";
import { appServerApprovalsReviewerOrNull, parseServiceTier } from "../../src/app-server/runtime-policy";

describe("app-server thread settings", () => {
  it("applies defined thread setting values and omits undefined values", () => {
    const update: ThreadSettingsUpdate = {};

    applyThreadSettingsValue(update, "model", "gpt-5.5");
    applyThreadSettingsValue(update, "effort", null);
    applyThreadSettingsValue(update, "serviceTier", undefined);

    expect(update).toEqual({ model: "gpt-5.5", effort: null });
  });

  it("parses supported approvals reviewer values", () => {
    expect(appServerApprovalsReviewerOrNull("user")).toBe("user");
    expect(appServerApprovalsReviewerOrNull("auto_review")).toBe("auto_review");
    expect(appServerApprovalsReviewerOrNull("guardian_subagent")).toBe("guardian_subagent");
    expect(appServerApprovalsReviewerOrNull("unknown")).toBeNull();
  });

  it("builds collaboration mode payloads with built-in instructions", () => {
    expect(appServerCollaborationMode("plan", "gpt-5.5", "high")).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    });
  });

  it("accepts non-empty service tier ids from config and app-server reports", () => {
    expect(parseServiceTier("fast")).toBe("fast");
    expect(parseServiceTier("standard")).toBe("standard");
    expect(parseServiceTier("priority")).toBe("priority");
    expect(parseServiceTier("default")).toBe("default");
    expect(parseServiceTier("flex")).toBe("flex");
    expect(parseServiceTier("auto")).toBe("auto");
    expect(parseServiceTier("catalog-tier")).toBe("catalog-tier");
  });

  it("ignores absent service tier values", () => {
    expect(parseServiceTier("")).toBeNull();
    expect(parseServiceTier(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { appServerRuntimeSettingsPatch } from "../../src/app-server/protocol/thread-settings";
import {
  applyRuntimeSettingsPatchValue,
  runtimeCollaborationModeSettings,
  type RuntimeSettingsPatch,
} from "../../src/domain/runtime/thread-settings";
import { approvalsReviewerOrNull, parseServiceTier } from "../../src/domain/runtime/policy";

describe("app-server thread settings", () => {
  it("applies defined thread setting values and omits undefined values", () => {
    const update: RuntimeSettingsPatch = {};

    applyRuntimeSettingsPatchValue(update, "model", "gpt-5.5");
    applyRuntimeSettingsPatchValue(update, "effort", null);
    applyRuntimeSettingsPatchValue(update, "serviceTier", undefined);

    expect(update).toEqual({ model: "gpt-5.5", effort: null });
  });

  it("parses supported approvals reviewer values", () => {
    expect(approvalsReviewerOrNull("user")).toBe("user");
    expect(approvalsReviewerOrNull("auto_review")).toBe("auto_review");
    expect(approvalsReviewerOrNull("guardian_subagent")).toBe("guardian_subagent");
    expect(approvalsReviewerOrNull("unknown")).toBeNull();
  });

  it("builds collaboration mode payloads with built-in instructions", () => {
    expect(runtimeCollaborationModeSettings("plan", "gpt-5.5", "high")).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoningEffort: "high",
        developerInstructions: null,
      },
    });
  });

  it("converts runtime settings patches to app-server thread settings params", () => {
    expect(
      appServerRuntimeSettingsPatch({
        collaborationMode: runtimeCollaborationModeSettings("plan", "gpt-5.5", "high"),
      }),
    ).toEqual({
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "high",
          developer_instructions: null,
        },
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

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

  it.each([
    ["user", "user"],
    ["auto_review", "auto_review"],
    ["guardian_subagent", "guardian_subagent"],
    ["unknown", null],
  ] as const)("parses approvals reviewer value %s", (value, expected) => {
    expect(approvalsReviewerOrNull(value)).toBe(expected);
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

  it.each([
    "fast",
    "standard",
    "priority",
    "default",
    "flex",
    "auto",
    "catalog-tier",
  ])("accepts non-empty service tier id %s from config and app-server reports", (serviceTier) => {
    expect(parseServiceTier(serviceTier)).toBe(serviceTier);
  });

  it.each(["", null])("ignores absent service tier value %s", (serviceTier) => {
    expect(parseServiceTier(serviceTier)).toBeNull();
  });
});

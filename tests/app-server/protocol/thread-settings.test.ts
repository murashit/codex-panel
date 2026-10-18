import { describe, expect, it } from "vitest";

import { appServerRuntimeSettingsPatch } from "../../../src/app-server/protocol/thread-settings";
import { approvalsReviewerOrNull, parseServiceTier, runtimeCollaborationModeSettings } from "../../../src/domain/runtime/settings";

describe("app-server thread settings", () => {
  it.each([
    ["user", "user"],
    ["auto_review", "auto_review"],
    ["guardian_subagent", "guardian_subagent"],
    ["unknown", null],
  ] as const)("parses approvals reviewer value %s", (value, expected) => {
    expect(approvalsReviewerOrNull(value)).toBe(expected);
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
    expect(appServerRuntimeSettingsPatch({ permissions: ":workspace" })).toEqual({ permissions: ":workspace" });
  });

  // Service-tier IDs are opaque here; the live app-server may canonicalize or omit them per model catalog.
  it("accepts opaque non-empty service tier ids from config and app-server reports", () => {
    expect(parseServiceTier("catalog-tier")).toBe("catalog-tier");
    expect(parseServiceTier("default")).toBe("default");
  });

  it.each(["", null])("ignores absent service tier value %s", (serviceTier) => {
    expect(parseServiceTier(serviceTier)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { appServerRuntimeSettingsPatch } from "../../../src/app-server/protocol/thread-settings";
import { runtimeCollaborationModeSettings } from "../../../src/domain/runtime/settings";

describe("app-server thread settings", () => {
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
});

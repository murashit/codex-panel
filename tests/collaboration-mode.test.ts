import { describe, expect, it } from "vitest";

import {
  collaborationModeLabel,
  collaborationModeToggleMessage,
  defaultCollaborationMode,
  nextCollaborationMode,
  planCollaborationMode,
} from "../src/panel/collaboration-mode";

describe("collaboration mode", () => {
  it("toggles between Default and Plan mode", () => {
    expect(nextCollaborationMode("default")).toBe("plan");
    expect(nextCollaborationMode("plan")).toBe("default");
    expect(collaborationModeLabel("default")).toBe("Default");
    expect(collaborationModeLabel("plan")).toBe("Plan");
  });

  it("formats slash command status messages", () => {
    expect(collaborationModeToggleMessage("plan")).toBe("Plan mode on for subsequent turns.");
    expect(collaborationModeToggleMessage("default")).toBe("Plan mode off for subsequent turns.");
  });

  it("builds the Plan collaboration mode payload", () => {
    expect(planCollaborationMode("gpt-5.5", "high")).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    });
  });

  it("builds the Default collaboration mode payload", () => {
    expect(defaultCollaborationMode("gpt-5.5", "high")).toEqual({
      mode: "default",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    });
  });
});

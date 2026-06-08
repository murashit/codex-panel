import { describe, expect, it } from "vitest";

import { collaborationModeLabel, collaborationModeToggleMessage, nextCollaborationMode } from "../../src/runtime/override-commands";

describe("runtime override commands", () => {
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
});

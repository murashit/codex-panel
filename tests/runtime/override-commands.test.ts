import { describe, expect, it } from "vitest";

import { collaborationModeLabel, nextCollaborationMode } from "../../src/features/chat/runtime/pending-settings";

describe("runtime collaboration mode", () => {
  it("toggles between Default and Plan mode", () => {
    expect(nextCollaborationMode("default")).toBe("plan");
    expect(nextCollaborationMode("plan")).toBe("default");
    expect(collaborationModeLabel("default")).toBe("Default");
    expect(collaborationModeLabel("plan")).toBe("Plan");
  });
});

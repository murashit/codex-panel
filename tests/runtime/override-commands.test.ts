import { describe, expect, it } from "vitest";

import { collaborationModeLabel } from "../../src/features/chat/presentation/runtime/messages";
import { nextCollaborationMode } from "../../src/features/chat/domain/runtime/pending-settings";

describe("runtime collaboration mode", () => {
  it("toggles between Default and Plan mode", () => {
    expect(nextCollaborationMode("default")).toBe("plan");
    expect(nextCollaborationMode("plan")).toBe("default");
    expect(collaborationModeLabel("default")).toBe("Default");
    expect(collaborationModeLabel("plan")).toBe("Plan");
  });
});

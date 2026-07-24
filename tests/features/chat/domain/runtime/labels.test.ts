import { describe, expect, it } from "vitest";
import { compactReasoningEffortLabel } from "../../../../../src/features/chat/domain/runtime/labels";

describe("runtime labels", () => {
  it("formats compact runtime labels", () => {
    expect(compactReasoningEffortLabel("minimal")).toBe("min");
    expect(compactReasoningEffortLabel("high")).toBe("high");
    expect(compactReasoningEffortLabel(null)).toBe("default");
  });
});

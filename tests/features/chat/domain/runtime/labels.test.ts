import { describe, expect, it } from "vitest";
import {
  compactReasoningEffortLabel,
  modelOverrideMessage,
  reasoningEffortOverrideMessage,
} from "../../../../../src/features/chat/domain/runtime/labels";

describe("runtime labels", () => {
  it("formats runtime override messages", () => {
    expect(modelOverrideMessage("gpt-5.5")).toBe("Model set to gpt-5.5 for subsequent turns.");
    expect(modelOverrideMessage(null)).toBe("Model reset to default for subsequent turns.");
    expect(reasoningEffortOverrideMessage("low")).toBe("Reasoning effort set to low for subsequent turns.");
    expect(reasoningEffortOverrideMessage(null)).toBe("Reasoning effort reset to default for subsequent turns.");
  });

  it("formats compact runtime labels", () => {
    expect(compactReasoningEffortLabel("minimal")).toBe("min");
    expect(compactReasoningEffortLabel("high")).toBe("high");
    expect(compactReasoningEffortLabel(null)).toBe("default");
  });
});

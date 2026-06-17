import { describe, expect, it } from "vitest";

import { isLocalSteerMessageClientId, isLocalUserMessageId } from "../../../src/features/chat/domain/local-message-ids";

describe("local chat message IDs", () => {
  it("classifies local prompt and steer message identifiers", () => {
    expect(isLocalUserMessageId("local-user-1234-test-1-1")).toBe(true);
    expect(isLocalUserMessageId("local-steer-1234-test-1-1")).toBe(true);
    expect(isLocalUserMessageId("user-1")).toBe(false);
    expect(isLocalSteerMessageClientId("local-steer-1234-test-1-1")).toBe(true);
    expect(isLocalSteerMessageClientId("local-user-1234-test-1-1")).toBe(false);
  });
});

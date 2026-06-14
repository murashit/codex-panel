import { describe, expect, it } from "vitest";

import {
  createLocalChatItemIdFactory,
  isLocalSteerMessageClientId,
  isLocalUserMessageId,
} from "../../../src/features/chat/domain/local-id";

describe("local chat item ids", () => {
  it("generates monotonic IDs per factory with a stable prefix and timestamp", () => {
    const ids = createLocalChatItemIdFactory({ nowMs: () => 1234, seed: "test" });
    const first = ids.next("local-user");
    const second = ids.next("local-user");
    const third = ids.next("system");

    expect(first).toMatch(/^local-user-1234-test-[a-z0-9]+-1$/);
    expect(second).toMatch(/^local-user-1234-test-[a-z0-9]+-2$/);
    expect(third).toMatch(/^system-1234-test-[a-z0-9]+-3$/);
  });

  it("keeps factories distinct when they share a timestamp and seed", () => {
    const first = createLocalChatItemIdFactory({ nowMs: () => 1234, seed: "test" });
    const second = createLocalChatItemIdFactory({ nowMs: () => 1234, seed: "test" });

    expect(first.next("local-user")).not.toBe(second.next("local-user"));
  });

  it("classifies local prompt and steer message identifiers", () => {
    expect(isLocalUserMessageId("local-user-1234-test-1-1")).toBe(true);
    expect(isLocalUserMessageId("local-steer-1234-test-1-1")).toBe(true);
    expect(isLocalUserMessageId("user-1")).toBe(false);
    expect(isLocalSteerMessageClientId("local-steer-1234-test-1-1")).toBe(true);
    expect(isLocalSteerMessageClientId("local-user-1234-test-1-1")).toBe(false);
  });
});

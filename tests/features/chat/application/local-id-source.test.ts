import { describe, expect, it } from "vitest";

import { createLocalIdSource } from "../../../../src/features/chat/application/local-id-source";

describe("local ID source", () => {
  it("keeps sources distinct when they share a timestamp and seed", () => {
    const first = createLocalIdSource({ nowMs: () => 1234, seed: "test" });
    const second = createLocalIdSource({ nowMs: () => 1234, seed: "test" });

    expect(first.next("local-user")).not.toBe(second.next("local-user"));
  });
});

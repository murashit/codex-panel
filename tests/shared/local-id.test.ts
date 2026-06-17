import { describe, expect, it } from "vitest";

import { createLocalIdSource } from "../../src/shared/id/local-id";

describe("local ID source", () => {
  it("generates monotonic IDs per source with a stable prefix and timestamp", () => {
    const ids = createLocalIdSource({ nowMs: () => 1234, seed: "test" });
    const first = ids.next("local-user");
    const second = ids.next("local-user");
    const third = ids.next("system");

    expect(first).toMatch(/^local-user-1234-test-[a-z0-9]+-1$/);
    expect(second).toMatch(/^local-user-1234-test-[a-z0-9]+-2$/);
    expect(third).toMatch(/^system-1234-test-[a-z0-9]+-3$/);
  });

  it("keeps sources distinct when they share a timestamp and seed", () => {
    const first = createLocalIdSource({ nowMs: () => 1234, seed: "test" });
    const second = createLocalIdSource({ nowMs: () => 1234, seed: "test" });

    expect(first.next("local-user")).not.toBe(second.next("local-user"));
  });

  it("sanitizes dynamic ID parts", () => {
    const ids = createLocalIdSource({ nowMs: () => 1234, seed: "test seed!" });

    expect(ids.next("bad prefix!")).toMatch(/^badprefix-1234-testseed-[a-z0-9]+-1$/);
  });
});

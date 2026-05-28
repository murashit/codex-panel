import { describe, expect, it } from "vitest";

import { parseServiceTier, serviceTierRequestValue } from "../../src/app-server/service-tier";

describe("service tier", () => {
  it("accepts the service tiers supported by the panel UI", () => {
    expect(parseServiceTier("fast")).toBe("fast");
    expect(parseServiceTier("standard")).toBe("standard");
  });

  it("ignores unknown config values", () => {
    expect(parseServiceTier("priority")).toBeNull();
    expect(parseServiceTier("default")).toBeNull();
    expect(parseServiceTier("flex")).toBeNull();
    expect(parseServiceTier("auto")).toBeNull();
    expect(parseServiceTier(null)).toBeNull();
  });

  it("serializes standard mode as explicit null instead of flex", () => {
    expect(serviceTierRequestValue("fast")).toBe("fast");
    expect(serviceTierRequestValue("standard")).toBeNull();
    expect(serviceTierRequestValue(null)).toBeUndefined();
  });
});

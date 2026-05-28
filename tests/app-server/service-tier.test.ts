import { describe, expect, it } from "vitest";

import { configuredServiceTierRequestValue, parseServiceTier, requestedServiceTierRequestValue } from "../../src/app-server/service-tier";

describe("service tier", () => {
  it("accepts non-empty service tier ids from config and app-server reports", () => {
    expect(parseServiceTier("fast")).toBe("fast");
    expect(parseServiceTier("standard")).toBe("standard");
    expect(parseServiceTier("priority")).toBe("priority");
    expect(parseServiceTier("default")).toBe("default");
    expect(parseServiceTier("flex")).toBe("flex");
    expect(parseServiceTier("auto")).toBe("auto");
    expect(parseServiceTier("catalog-tier")).toBe("catalog-tier");
  });

  it("ignores absent config values", () => {
    expect(parseServiceTier("")).toBeNull();
    expect(parseServiceTier(null)).toBeNull();
  });

  it("serializes panel fast mode off as an explicit null request", () => {
    expect(requestedServiceTierRequestValue("fast")).toBe("fast");
    expect(requestedServiceTierRequestValue("off")).toBeNull();
    expect(requestedServiceTierRequestValue(null)).toBeUndefined();
  });

  it("passes configured service tier ids through to new turns", () => {
    expect(configuredServiceTierRequestValue("flex")).toBe("flex");
    expect(configuredServiceTierRequestValue("catalog-tier")).toBe("catalog-tier");
    expect(configuredServiceTierRequestValue(null)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  configuredServiceTierRequestValue,
  isFastServiceTier,
  parseServiceTier,
  requestedServiceTierRequestValue,
} from "../../src/app-server/service-tier";

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
    expect(requestedServiceTierRequestValue("fast", "priority")).toBe("priority");
    expect(requestedServiceTierRequestValue("off")).toBeNull();
    expect(requestedServiceTierRequestValue(null)).toBeUndefined();
  });

  it("passes configured service tier ids through to new turns", () => {
    expect(configuredServiceTierRequestValue("flex")).toBe("flex");
    expect(configuredServiceTierRequestValue("catalog-tier")).toBe("catalog-tier");
    expect(configuredServiceTierRequestValue(null)).toBeUndefined();
  });

  it("recognizes Codex fast tier aliases without rejecting other tier ids", () => {
    expect(isFastServiceTier("fast")).toBe(true);
    expect(isFastServiceTier("priority")).toBe(true);
    expect(isFastServiceTier("catalog-fast", [{ id: "catalog-fast", name: "Fast" }])).toBe(true);
    expect(isFastServiceTier("priority", [{ id: "priority", name: "Priority" }])).toBe(false);
    expect(isFastServiceTier("flex", [{ id: "flex", name: "Flex" }])).toBe(false);
  });

  it("locks the Codex 0.134.0 Fast catalog semantics observed from app-server", () => {
    // Codex app-server 0.134.0 reports Fast as serviceTiers[{ id: "priority", name: "Fast" }].
    const codex01340FastTier = { id: "priority", name: "Fast" };

    expect(requestedServiceTierRequestValue("fast", codex01340FastTier.id)).toBe("priority");
    expect(isFastServiceTier("priority", [codex01340FastTier])).toBe(true);

    // Clearing Fast with serviceTier: null is reported back by 0.134.0 as "default", not null.
    expect(isFastServiceTier("default", [codex01340FastTier])).toBe(false);
  });
});

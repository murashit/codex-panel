import { describe, expect, it } from "vitest";

import { isFastServiceTier } from "../../src/features/chat/runtime/service-tier-state";

describe("service tier runtime state", () => {
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

    expect(isFastServiceTier("priority", [codex01340FastTier])).toBe(true);

    // Clearing Fast with serviceTier: null is reported back by 0.134.0 as "default", not null.
    expect(isFastServiceTier("default", [codex01340FastTier])).toBe(false);
  });
});

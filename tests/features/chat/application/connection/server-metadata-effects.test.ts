import { describe, expect, it, vi } from "vitest";

import { createServerMetadataEffects } from "../../../../../src/features/chat/application/connection/server-metadata-effects";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatStateFixture } from "../../support/state";

describe("server metadata effects", () => {
  it("refreshes shared metadata without writing a panel mirror", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshAppServerMetadata = vi.fn().mockResolvedValue(undefined);
    const effects = createServerMetadataEffects({
      stateStore,
      ...refreshHost(),
      refreshAppServerMetadata,
    });

    await effects.refreshAppServerMetadata();

    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection).not.toHaveProperty("runtimeConfig");
    expect(stateStore.getState().connection).not.toHaveProperty("availableSkills");
  });

  it("routes resource facts to their shared query refresh", async () => {
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    const refreshRateLimits = vi.fn().mockResolvedValue(undefined);
    const effects = createServerMetadataEffects({
      stateStore: createChatStateStore(chatStateFixture()),
      ...refreshHost(),
      refreshSkills,
      refreshRateLimits,
    });

    await effects.handleAppServerResourceFact({ type: "skills-changed" });
    await effects.handleAppServerResourceFact({ type: "rate-limits-updated" });

    expect(refreshSkills).toHaveBeenCalledOnce();
    expect(refreshRateLimits).toHaveBeenCalledOnce();
  });

  it("keeps MCP startup status in panel diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const effects = createServerMetadataEffects({ stateStore, ...refreshHost() });

    await effects.handleAppServerResourceFact({
      type: "mcp-startup-status-updated",
      name: "github",
      status: "ready",
      message: null,
    });

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([{ name: "github", startupStatus: "ready" }]);
  });

  it("ignores stale runtime failures but propagates ordinary refresh failures", async () => {
    const stale = new Error("stale");
    const ordinary = new Error("offline");
    const staleEffects = createServerMetadataEffects({
      stateStore: createChatStateStore(chatStateFixture()),
      ...refreshHost(),
      refreshSkills: vi.fn().mockRejectedValue(stale),
      isStaleRuntimeError: (error) => error === stale,
    });
    const failingEffects = createServerMetadataEffects({
      stateStore: createChatStateStore(chatStateFixture()),
      ...refreshHost(),
      refreshRateLimits: vi.fn().mockRejectedValue(ordinary),
    });

    await expect(staleEffects.handleAppServerResourceFact({ type: "skills-changed" })).resolves.toBeUndefined();
    await expect(failingEffects.handleAppServerResourceFact({ type: "rate-limits-updated" })).rejects.toBe(ordinary);
  });
});

function refreshHost() {
  return {
    refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
    refreshSkills: vi.fn().mockResolvedValue(undefined),
    refreshRateLimits: vi.fn().mockResolvedValue(undefined),
    isStaleRuntimeError: () => false,
  };
}

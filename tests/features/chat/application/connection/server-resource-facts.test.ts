import { describe, expect, it, vi } from "vitest";

import { handleAppServerResourceFact } from "../../../../../src/features/chat/application/connection/server-resource-facts";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatStateFixture } from "../../support/state";

describe("server resource facts", () => {
  it("routes resource facts to their shared query refresh", async () => {
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    const refreshRateLimits = vi.fn().mockResolvedValue(undefined);
    const host = {
      stateStore: createChatStateStore(chatStateFixture()),
      refreshSkills,
      refreshRateLimits,
    };

    await handleAppServerResourceFact(host, { type: "skills-changed" });
    await handleAppServerResourceFact(host, { type: "rate-limits-updated" });

    expect(refreshSkills).toHaveBeenCalledOnce();
    expect(refreshRateLimits).toHaveBeenCalledOnce();
  });

  it("keeps MCP startup status in panel diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());

    await handleAppServerResourceFact(
      { stateStore, ...refreshHost() },
      {
        type: "mcp-startup-status-updated",
        name: "github",
        status: "ready",
        message: null,
      },
    );

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([{ name: "github", startupStatus: "ready" }]);
  });

  it("propagates resource refresh failures", async () => {
    const ordinary = new Error("offline");
    const host = {
      stateStore: createChatStateStore(chatStateFixture()),
      ...refreshHost(),
      refreshRateLimits: vi.fn().mockRejectedValue(ordinary),
    };

    await expect(handleAppServerResourceFact(host, { type: "rate-limits-updated" })).rejects.toBe(ordinary);
  });
});

function refreshHost() {
  return {
    refreshSkills: vi.fn().mockResolvedValue(undefined),
    refreshRateLimits: vi.fn().mockResolvedValue(undefined),
  };
}

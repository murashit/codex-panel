import { describe, expect, it, vi } from "vitest";

import { handleAppServerResourceFact } from "../../../../../src/features/chat/application/connection/server-resource-facts";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatStateFixture } from "../../support/state";

describe("server resource facts", () => {
  it.each([
    ["skills-changed", "refreshSkills"],
    ["rate-limits-updated", "refreshRateLimits"],
  ] as const)("routes %s failures through %s", async (type, target) => {
    const error = new Error("offline");
    const host = {
      stateStore: createChatStateStore(chatStateFixture()),
      refreshSkills: vi.fn().mockResolvedValue(undefined),
      refreshRateLimits: vi.fn().mockResolvedValue(undefined),
    };
    host[target].mockRejectedValue(error);

    await expect(handleAppServerResourceFact(host, { type })).rejects.toBe(error);

    expect(host[target]).toHaveBeenCalledOnce();
  });

  it("keeps MCP startup status in panel diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());

    await handleAppServerResourceFact(
      { stateStore, refreshSkills: async () => undefined, refreshRateLimits: async () => undefined },
      {
        type: "mcp-startup-status-updated",
        name: "github",
        status: "ready",
        message: null,
      },
    );

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([{ name: "github", startupStatus: "ready" }]);
  });
});

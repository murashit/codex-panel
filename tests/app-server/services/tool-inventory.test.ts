import { describe, expect, it, vi } from "vitest";

import { readMcpServerInventory } from "../../../src/app-server/services/tool-inventory";

describe("tool inventory", () => {
  it("loads every MCP server status page", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [mcpServerStatus("first")], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [mcpServerStatus("second")], nextCursor: null });
    const result = await readMcpServerInventory({ request }, "thread");

    expect(request.mock.calls).toEqual([
      ["mcpServerStatus/list", { detail: "toolsAndAuthOnly", cursor: null, limit: 100, threadId: "thread" }],
      ["mcpServerStatus/list", { detail: "toolsAndAuthOnly", cursor: "next", limit: 100, threadId: "thread" }],
    ]);
    expect(result.servers).toEqual([
      expect.objectContaining({ name: "first", connectionStatus: "connected" }),
      expect.objectContaining({ name: "second", connectionStatus: "connected" }),
    ]);
  });

  it("reports runtime connection and authentication issues without loading resource inventories", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ ...mcpServerStatus("github"), runtimeStatus: "authenticationRequired", authStatus: "notLoggedIn" }],
      nextCursor: null,
    });

    const result = await readMcpServerInventory({ request }, "thread");

    expect(request.mock.calls).toEqual([
      ["mcpServerStatus/list", { detail: "toolsAndAuthOnly", cursor: null, limit: 100, threadId: "thread" }],
    ]);
    expect(result.servers).toEqual([
      {
        name: "github",
        authStatus: "notLoggedIn",
        toolCount: 0,
        toolDiscoveryFailed: false,
        connectionStatus: "authenticationRequired",
        codexAppIds: [],
      },
    ]);
  });
});

function mcpServerStatus(name: string) {
  return {
    name,
    runtimeStatus: "connected",
    serverInfo: null,
    tools: {},
    toolsError: null,
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
  };
}

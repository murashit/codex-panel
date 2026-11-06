import { describe, expect, it, vi } from "vitest";

import { readInstalledPluginInventory, readMcpServerInventory } from "../../../src/app-server/services/tool-inventory";

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

  it.each([
    ["AVAILABLE", null, null],
    ["DISABLED_BY_ADMIN", null, "admin"],
    ["DISABLED_BY_ADMIN", "disabled_by_admin", "admin"],
    ["DISABLED_BY_ADMIN", "plan_not_eligible", "plan"],
    ["DISABLED_BY_ADMIN", "required_app_unavailable", "requiredApp"],
    ["DISABLED_BY_ADMIN", "unknown", "unknown"],
  ])("retains installed plugin availability (%s, %s) without loading details", async (availability, disabledReason, unavailableReason) => {
    const request = vi.fn().mockResolvedValue({
      marketplaces: [
        {
          name: "remote-marketplace",
          path: null,
          plugins: [
            {
              id: "remote-plugin@remote-marketplace",
              name: "remote-plugin",
              interface: { displayName: "Remote Plugin" },
              localVersion: "2.0.0",
              installed: true,
              enabled: true,
              availability,
              disabledReason,
              source: { type: "remote" },
            },
          ],
        },
        {
          name: "local-marketplace",
          path: "/marketplaces/local.json",
          plugins: [
            {
              id: "local-plugin@local-marketplace",
              name: "local-plugin",
              interface: { displayName: "Local Plugin" },
              localVersion: "1.0.0",
              installed: true,
              enabled: true,
              availability: "AVAILABLE",
              source: { type: "local", path: "/plugins/local-plugin" },
            },
          ],
        },
      ],
      marketplaceLoadErrors: [],
    });

    const result = await readInstalledPluginInventory({ request }, "/vault");

    expect(request.mock.calls).toEqual([["plugin/installed", { cwds: ["/vault"] }]]);
    expect(result.plugins.map((plugin) => plugin.name)).toEqual(["local-plugin", "remote-plugin"]);
    expect(result.plugins.map((plugin) => plugin.unavailableReason)).toEqual([null, unavailableReason]);
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

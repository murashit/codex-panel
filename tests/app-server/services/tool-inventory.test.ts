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

  it("reads sorted installed plugins and their reported unavailability without loading details", async () => {
    const request = vi.fn().mockResolvedValue({
      marketplaces: [
        {
          name: "remote-marketplace",
          path: null,
          plugins: ["unknown", "required_app_unavailable", "plan_not_eligible", "disabled_by_admin", null].map((disabledReason) => ({
            id: `${disabledReason ?? "fallback"}@remote-marketplace`,
            name: disabledReason ?? "fallback",
            interface: { displayName: "Remote Plugin" },
            localVersion: "2.0.0",
            installed: true,
            enabled: true,
            availability: "DISABLED_BY_ADMIN",
            disabledReason,
            source: { type: "remote" },
          })),
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
    expect(result.plugins.map(({ name, unavailableReason }) => ({ name, unavailableReason }))).toEqual([
      { name: "disabled_by_admin", unavailableReason: "admin" },
      { name: "fallback", unavailableReason: "admin" },
      { name: "local-plugin", unavailableReason: null },
      { name: "plan_not_eligible", unavailableReason: "plan" },
      { name: "required_app_unavailable", unavailableReason: "requiredApp" },
      { name: "unknown", unavailableReason: "unknown" },
    ]);
    expect(result.plugins[3]).toMatchObject({ enabled: true, installed: true, localVersion: "2.0.0" });
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

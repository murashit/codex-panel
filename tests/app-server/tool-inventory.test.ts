import { describe, expect, it, vi } from "vitest";

import type { AppServerRequestClient } from "../../src/app-server/services/request-client";
import { readToolInventory } from "../../src/app-server/services/tool-inventory";

describe("tool inventory", () => {
  it("loads every MCP server status page", async () => {
    const listMcpServers = vi
      .fn()
      .mockResolvedValueOnce({ data: [mcpServerStatus("first")], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [mcpServerStatus("second")], nextCursor: null });
    const client = toolInventoryClient({ "mcpServerStatus/list": listMcpServers });

    const result = await readToolInventory(client, "/vault", { threadId: "thread" });

    expect(result.inventory.mcpServers?.map((server) => server.name)).toEqual(["first", "second"]);
    expect(listMcpServers).toHaveBeenNthCalledWith(1, {
      detail: "toolsAndAuthOnly",
      cursor: null,
      limit: 100,
      threadId: "thread",
    });
    expect(listMcpServers).toHaveBeenNthCalledWith(2, {
      detail: "toolsAndAuthOnly",
      cursor: "next",
      limit: 100,
      threadId: "thread",
    });
  });

  it("reports repeated MCP server status cursors", async () => {
    const client = toolInventoryClient({
      "mcpServerStatus/list": vi.fn().mockResolvedValue({ data: [mcpServerStatus("github")], nextCursor: "repeat" }),
    });

    const result = await readToolInventory(client, "/vault");

    expect(result.inventory.mcpServers).toBeNull();
    expect(result.inventory.mcpError).toContain("repeated MCP server status list cursor");
  });

  it("reads installed plugins without loading plugin details", async () => {
    const readPlugin = vi.fn();
    const client = toolInventoryClient({
      "plugin/installed": vi.fn().mockResolvedValue({
        marketplaces: [
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
                availability: "AVAILABLE",
                source: { type: "remote" },
              },
            ],
          },
        ],
        marketplaceLoadErrors: [],
      }),
      "plugin/read": readPlugin,
    });

    const result = await readToolInventory(client, "/vault");

    expect(readPlugin).not.toHaveBeenCalled();
    expect(result.inventory.plugins?.map((plugin) => plugin.name)).toEqual(["local-plugin", "remote-plugin"]);
  });

  it("skips app catalog loading during diagnostics", async () => {
    const client = toolInventoryClient();

    const result = await readToolInventory(client, "/vault");

    expect(client.request).not.toHaveBeenCalledWith("app/list", expect.anything());
    expect(result.probes.some((probe) => probe.id === "apps")).toBe(false);
  });

  it("preserves plugin order from installed plugin summaries", async () => {
    const plugins = Array.from({ length: 10 }, (_, index) => installedPlugin(`plugin-${String(index)}`));
    const readPlugin = vi.fn();
    const client = toolInventoryClient({
      "plugin/installed": vi.fn().mockResolvedValue({
        marketplaces: [{ name: "local-marketplace", path: "/marketplaces/local.json", plugins }],
        marketplaceLoadErrors: [],
      }),
      "plugin/read": readPlugin,
    });

    const result = await readToolInventory(client, "/vault");

    expect(readPlugin).not.toHaveBeenCalled();
    expect(result.inventory.plugins?.map((plugin) => plugin.name)).toEqual(plugins.map((plugin) => plugin.name));
  });
});

function toolInventoryClient(
  overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
): AppServerRequestClient & { request: ReturnType<typeof vi.fn> } {
  const handlers = {
    "plugin/installed": vi.fn().mockResolvedValue({
      marketplaces: [],
      marketplaceLoadErrors: [],
    }),
    "plugin/read": vi.fn().mockResolvedValue({
      plugin: { skills: [], hooks: [], apps: [], appTemplates: [], mcpServers: [] },
    }),
    "mcpServerStatus/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    ...overrides,
  };
  const request = vi.fn(async (method: string, params: unknown) => {
    switch (method) {
      case "plugin/installed":
        return (handlers["plugin/installed"] as unknown as (params: unknown) => Promise<unknown>)(params);
      case "plugin/read":
        return (handlers["plugin/read"] as unknown as (params: unknown) => Promise<unknown>)(params);
      case "mcpServerStatus/list":
        return (handlers["mcpServerStatus/list"] as unknown as (params: unknown) => Promise<unknown>)(params);
      case "skills/list":
        return { data: [{ cwd: "/vault", skills: [] }] };
      default:
        throw new Error(`Unexpected app-server request: ${method}`);
    }
  });
  return {
    request,
  } as unknown as AppServerRequestClient & { request: ReturnType<typeof vi.fn> };
}

function mcpServerStatus(name: string) {
  return {
    name,
    serverInfo: null,
    tools: {},
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
  };
}

function installedPlugin(name: string): {
  id: string;
  name: string;
  interface: { displayName: string };
  localVersion: string;
  installed: boolean;
  enabled: boolean;
  availability: string;
  source: { type: string; path: string };
} {
  return {
    id: `${name}@local-marketplace`,
    name,
    interface: { displayName: name },
    localVersion: "1.0.0",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    source: { type: "local", path: `/plugins/${name}` },
  };
}

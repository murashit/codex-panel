import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import { readToolInventory } from "../../src/app-server/tool-inventory";

describe("tool inventory", () => {
  it("reads plugin details with exactly one marketplace locator", async () => {
    const readPlugin = vi.fn(async (params: Parameters<AppServerClient["readPlugin"]>[0]) => ({
      plugin: {
        skills: params.pluginName === "local-plugin" ? [{ name: "local-skill" }] : [],
        hooks: [],
        apps: [],
        appTemplates: [],
        mcpServers: params.pluginName === "remote-plugin" ? ["remote-server"] : [],
      },
    }));
    const client = {
      listApps: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      listInstalledPlugins: vi.fn().mockResolvedValue({
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
      readPlugin,
      listMcpServerStatus: vi.fn().mockResolvedValue({ data: [] }),
      listSkills: vi.fn().mockResolvedValue({ data: [{ cwd: "/vault", skills: [] }] }),
    } as unknown as AppServerClient;

    const result = await readToolInventory(client, "/vault");

    expect(readPlugin).toHaveBeenCalledWith({
      pluginName: "local-plugin",
      marketplacePath: "/marketplaces/local.json",
    });
    expect(readPlugin).toHaveBeenCalledWith({
      pluginName: "remote-plugin",
      remoteMarketplaceName: "remote-marketplace",
    });
    expect(readPlugin).not.toHaveBeenCalledWith(
      expect.objectContaining({ marketplacePath: expect.any(String), remoteMarketplaceName: expect.any(String) }),
    );
    expect(result.inventory.plugins?.map((plugin) => [plugin.name, plugin.details, plugin.detailsError])).toEqual([
      ["local-plugin", { skillCount: 1, hookCount: 0, appCount: 0, mcpServerCount: 0 }, null],
      ["remote-plugin", { skillCount: 0, hookCount: 0, appCount: 0, mcpServerCount: 1 }, null],
    ]);
  });
});

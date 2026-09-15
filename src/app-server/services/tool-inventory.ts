import type { McpServerStatusSummary } from "../../domain/server/mcp-status";
import type { ToolInventoryPlugin } from "../../domain/server/tool-inventory";
import { mcpServerStatusSummariesFromStatuses, toolInventoryPluginsFromInstalledResponse } from "../protocol/tool-inventory";
import { collectCursorPages } from "./cursor-pages";
import type { AppServerRequestClient } from "./request-client";

export interface InstalledPluginInventory {
  readonly plugins: readonly ToolInventoryPlugin[];
}

export interface McpServerInventory {
  readonly servers: readonly McpServerStatusSummary[];
}

export async function readInstalledPluginInventory(
  client: AppServerRequestClient,
  cwd: string,
  options: { signal?: AbortSignal } = {},
): Promise<InstalledPluginInventory> {
  // As of Codex CLI 0.142.3, app/list can enumerate the full app catalog and leave
  // app-server CPU-bound after returning. Keep diagnostics on MCP/plugin data
  // until the app-list API can provide a cheap installed-or-enabled summary.
  options.signal?.throwIfAborted();
  const response = await client.request("plugin/installed", { cwds: [cwd] });
  options.signal?.throwIfAborted();
  return { plugins: toolInventoryPluginsFromInstalledResponse(response) };
}

export async function readMcpServerInventory(
  client: AppServerRequestClient,
  threadId: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<McpServerInventory> {
  const servers = await collectCursorPages(async (cursor) => {
    options.signal?.throwIfAborted();
    const response = await client.request("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
      cursor,
      limit: 100,
      ...(threadId ? { threadId } : {}),
    });
    options.signal?.throwIfAborted();
    return { ...response, data: mcpServerStatusSummariesFromStatuses(response.data) };
  }, "MCP server status list");
  return { servers };
}

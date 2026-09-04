import { type McpServerStatusSummary, mcpServerStatusSummariesFromStatuses } from "../../domain/server/mcp-status";
import type { ToolInventoryMarketplaceError, ToolInventoryPlugin } from "../../domain/server/tool-inventory";
import type { ClientResponseByMethod } from "../connection/client";
import { toolInventoryPluginsFromInstalledResponse } from "../protocol/tool-inventory";
import type { AppServerRequestClient } from "./request-client";

export interface InstalledPluginInventory {
  readonly plugins: readonly ToolInventoryPlugin[];
  readonly marketplaceErrors: readonly ToolInventoryMarketplaceError[];
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
  const { plugins, marketplaceErrors } = toolInventoryPluginsFromInstalledResponse(response);
  return {
    plugins,
    marketplaceErrors,
  };
}

export async function readMcpServerInventory(
  client: AppServerRequestClient,
  threadId: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<McpServerInventory> {
  const servers: McpServerStatusSummary[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    options.signal?.throwIfAborted();
    const response: ClientResponseByMethod["mcpServerStatus/list"] = await client.request("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
      cursor,
      limit: 100,
      ...(threadId ? { threadId } : {}),
    });
    options.signal?.throwIfAborted();
    servers.push(...mcpServerStatusSummariesFromStatuses(response.data));
    cursor = response.nextCursor ?? null;
    if (!cursor) break;
    if (seenCursors.has(cursor)) throw new Error("Codex app-server returned a repeated MCP server status list cursor.");
    seenCursors.add(cursor);
  }
  return { servers };
}

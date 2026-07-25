import {
  type DiagnosticProbeResult,
  diagnosticProbeError,
  diagnosticProbeOk,
  shortDiagnosticErrorMessage,
} from "../../domain/server/diagnostics";
import {
  type McpServerDiagnostic,
  type McpServerStatusSummary,
  mcpServerStatusSummariesFromStatuses,
} from "../../domain/server/mcp-status";
import type { ToolInventoryMarketplaceError, ToolInventoryPlugin, ToolInventorySnapshot } from "../../domain/server/tool-inventory";
import type { ClientResponseByMethod } from "../connection/client";
import { toolInventoryPluginsFromInstalledResponse } from "../protocol/tool-inventory";
import type { AppServerRequestClient } from "./request-client";

export interface ReadToolInventoryOptions {
  readonly threadId?: string | null;
  readonly mcpDiagnostics?: readonly McpServerDiagnostic[];
}

export interface ReadToolInventoryResult {
  readonly inventory: ToolInventorySnapshot;
  readonly probes: readonly DiagnosticProbeResult[];
  readonly mcpServerStatuses: readonly McpServerStatusSummary[] | null;
}

export async function readToolInventory(
  client: AppServerRequestClient,
  cwd: string,
  options: ReadToolInventoryOptions = {},
): Promise<ReadToolInventoryResult> {
  const checkedAt = Date.now();
  // As of Codex CLI 0.142.3, app/list can enumerate the full app catalog and leave
  // app-server CPU-bound after returning. Keep diagnostics on MCP/plugin data
  // until the app-list API can provide a cheap installed-or-enabled summary.
  const [plugins, mcp] = await Promise.all([
    readPlugins(client, cwd, checkedAt),
    readMcpServers(client, options.threadId ?? null, checkedAt),
  ]);

  return {
    inventory: {
      checkedAt,
      plugins: plugins.items,
      pluginMarketplaceErrors: plugins.marketplaceErrors,
      pluginsError: plugins.error,
      mcpServers: mcp.items,
      mcpDiagnostics: options.mcpDiagnostics ?? [],
      mcpError: mcp.error,
    },
    probes: [plugins.probe, mcp.probe],
    mcpServerStatuses: mcp.items,
  };
}

async function readPlugins(
  client: AppServerRequestClient,
  cwd: string,
  checkedAt: number,
): Promise<{
  items: ToolInventoryPlugin[] | null;
  marketplaceErrors: ToolInventoryMarketplaceError[];
  error: string | null;
  probe: DiagnosticProbeResult;
}> {
  try {
    const response = await client.request("plugin/installed", { cwds: [cwd] });
    const { plugins, marketplaceErrors } = toolInventoryPluginsFromInstalledResponse(response);
    return {
      items: plugins,
      marketplaceErrors,
      error: null,
      probe: diagnosticProbeOk("plugins", `${String(plugins.length)} plugins`, checkedAt),
    };
  } catch (error) {
    return {
      items: null,
      marketplaceErrors: [],
      error: shortDiagnosticErrorMessage(error),
      probe: diagnosticProbeError("plugins", error, checkedAt),
    };
  }
}

async function readMcpServers(
  client: AppServerRequestClient,
  threadId: string | null,
  checkedAt: number,
): Promise<{ items: McpServerStatusSummary[] | null; error: string | null; probe: DiagnosticProbeResult }> {
  try {
    const servers: McpServerStatusSummary[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const response: ClientResponseByMethod["mcpServerStatus/list"] = await client.request("mcpServerStatus/list", {
        detail: "toolsAndAuthOnly",
        cursor,
        limit: 100,
        ...(threadId ? { threadId } : {}),
      });
      servers.push(...mcpServerStatusSummariesFromStatuses(response.data));
      cursor = response.nextCursor ?? null;
      if (!cursor) break;
      if (seenCursors.has(cursor)) throw new Error("Codex app-server returned a repeated MCP server status list cursor.");
      seenCursors.add(cursor);
    }
    return {
      items: servers,
      error: null,
      probe: diagnosticProbeOk("mcpServers", mcpSummary(servers), checkedAt),
    };
  } catch (error) {
    return {
      items: null,
      error: shortDiagnosticErrorMessage(error),
      probe: diagnosticProbeError("mcpServers", error, checkedAt),
    };
  }
}

function mcpSummary(servers: readonly McpServerStatusSummary[]): string {
  const issueCount = servers.filter((server) => server.authStatus === "notLoggedIn").length;
  return issueCount > 0 ? `${String(servers.length)} servers, ${String(issueCount)} auth issues` : `${String(servers.length)} servers`;
}

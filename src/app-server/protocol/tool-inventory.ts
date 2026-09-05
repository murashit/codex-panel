import type { McpServerStatusSummary } from "../../domain/server/mcp-status";
import type { ToolInventoryMarketplaceError, ToolInventoryPlugin } from "../../domain/server/tool-inventory";
import type { MarketplaceLoadErrorInfo } from "../../generated/app-server/v2/MarketplaceLoadErrorInfo";
import type { McpServerStatus } from "../../generated/app-server/v2/McpServerStatus";
import type { PluginInstalledResponse } from "../../generated/app-server/v2/PluginInstalledResponse";
import type { PluginMarketplaceEntry } from "../../generated/app-server/v2/PluginMarketplaceEntry";
import type { PluginSource } from "../../generated/app-server/v2/PluginSource";
import type { PluginSummary } from "../../generated/app-server/v2/PluginSummary";

export function toolInventoryPluginsFromInstalledResponse(response: PluginInstalledResponse): {
  plugins: ToolInventoryPlugin[];
  marketplaceErrors: ToolInventoryMarketplaceError[];
} {
  return {
    plugins: response.marketplaces
      .flatMap((marketplace) => marketplace.plugins.map((plugin) => toolInventoryPluginFromSummary(plugin, marketplace)))
      .sort((a, b) => a.name.localeCompare(b.name)),
    marketplaceErrors: response.marketplaceLoadErrors.map(toolInventoryMarketplaceError),
  };
}

function toolInventoryPluginFromSummary(plugin: PluginSummary, marketplace: PluginMarketplaceEntry): ToolInventoryPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    displayName: plugin.interface?.displayName ?? null,
    marketplaceName: marketplace.name,
    marketplacePath: marketplace.path,
    localVersion: plugin.localVersion,
    installed: plugin.installed,
    enabled: plugin.enabled,
    availability: plugin.availability,
    source: pluginSourceLabel(plugin.source),
  };
}

function toolInventoryMarketplaceError(error: MarketplaceLoadErrorInfo): ToolInventoryMarketplaceError {
  return {
    marketplacePath: error.marketplacePath,
    message: error.message,
  };
}

function pluginSourceLabel(source: PluginSource): string {
  if (source.type === "local") return source.path;
  if (source.type === "git") {
    const ref = source.refName ? `#${source.refName}` : source.sha ? `#${source.sha.slice(0, 8)}` : "";
    const path = source.path ? `/${source.path}` : "";
    return `${source.url}${path}${ref}`;
  }
  if (source.type === "npm") return source.version ? `${source.package}@${source.version}` : source.package;
  return "remote";
}

// Tool names may be absent in status payloads; retain the map-key fallback at this boundary.
type McpStatusRecord = Pick<McpServerStatus, "name" | "runtimeStatus" | "authStatus"> & {
  readonly tools: Readonly<Record<string, unknown>>;
};

export function mcpServerStatusSummariesFromStatuses(servers: readonly McpStatusRecord[]): McpServerStatusSummary[] {
  return servers.map(mcpServerStatusSummaryFromStatus);
}

function mcpServerStatusSummaryFromStatus(server: McpStatusRecord): McpServerStatusSummary {
  return {
    name: server.name,
    authStatus: server.authStatus,
    toolCount: Object.keys(server.tools).length,
    connectionStatus: server.runtimeStatus,
    codexAppIds: server.name === "codex_apps" ? codexAppIdsFromTools(server.tools) : [],
  };
}

function codexAppIdsFromTools(tools: Readonly<Record<string, unknown>>): string[] {
  const appIds = new Set<string>();
  for (const [toolKey, tool] of Object.entries(tools)) {
    const toolName = toolNameFromStatusTool(tool) ?? toolKey;
    const prefixSeparator = toolName.indexOf(".");
    if (prefixSeparator <= 0) continue;
    appIds.add(toolName.slice(0, prefixSeparator));
  }
  return [...appIds].sort((left, right) => left.localeCompare(right));
}

function toolNameFromStatusTool(tool: unknown): string | null {
  if (!tool || typeof tool !== "object") return null;
  const name = (tool as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

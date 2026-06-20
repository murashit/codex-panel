import type { ToolInventoryApp, ToolInventoryMarketplaceError, ToolInventoryPlugin } from "../../domain/server/tool-inventory";

interface ToolInventoryAppInfo {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  isAccessible: boolean;
  distributionChannel: string | null;
  pluginDisplayNames: readonly string[];
  [key: string]: unknown;
}

interface ToolInventoryPluginInstalledResponse {
  marketplaces: readonly ToolInventoryPluginMarketplaceEntry[];
  marketplaceLoadErrors: readonly ToolInventoryMarketplaceLoadError[];
  [key: string]: unknown;
}

interface ToolInventoryPluginMarketplaceEntry {
  name: string;
  path: string | null;
  plugins: readonly ToolInventoryPluginSummary[];
  [key: string]: unknown;
}

interface ToolInventoryPluginSummary {
  id: string;
  name: string;
  interface: { displayName: string | null } | null;
  localVersion: string | null;
  installed: boolean;
  enabled: boolean;
  availability: string;
  source: ToolInventoryPluginSource;
  [key: string]: unknown;
}

type ToolInventoryPluginSource =
  | { type: "local"; path: string }
  | { type: "git"; url: string; path: string | null; refName: string | null; sha: string | null }
  | { type: "remote" };

interface ToolInventoryMarketplaceLoadError {
  marketplacePath: string;
  message: string;
  [key: string]: unknown;
}

export function toolInventoryAppsFromAppInfos(apps: readonly ToolInventoryAppInfo[]): ToolInventoryApp[] {
  return apps.map(toolInventoryAppFromAppInfo).sort((a, b) => a.name.localeCompare(b.name));
}

export function toolInventoryPluginsFromInstalledResponse(response: ToolInventoryPluginInstalledResponse): {
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

function toolInventoryAppFromAppInfo(app: ToolInventoryAppInfo): ToolInventoryApp {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    enabled: app.isEnabled,
    accessible: app.isAccessible,
    distributionChannel: app.distributionChannel,
    pluginDisplayNames: [...app.pluginDisplayNames],
  };
}

function toolInventoryPluginFromSummary(
  plugin: ToolInventoryPluginSummary,
  marketplace: ToolInventoryPluginMarketplaceEntry,
): ToolInventoryPlugin {
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
    details: null,
    detailsError: null,
  };
}

function toolInventoryMarketplaceError(error: ToolInventoryMarketplaceLoadError): ToolInventoryMarketplaceError {
  return {
    marketplacePath: error.marketplacePath,
    message: error.message,
  };
}

function pluginSourceLabel(source: ToolInventoryPluginSource): string {
  if (source.type === "local") return source.path;
  if (source.type === "git") {
    const ref = source.refName ? `#${source.refName}` : source.sha ? `#${source.sha.slice(0, 8)}` : "";
    const path = source.path ? `/${source.path}` : "";
    return `${source.url}${path}${ref}`;
  }
  return "remote";
}

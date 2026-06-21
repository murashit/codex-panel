import {
  diagnosticProbeError,
  diagnosticProbeOk,
  mcpServerStatusSummariesFromStatuses,
  type DiagnosticProbeResult,
  type McpServerDiagnostic,
  type McpServerStatusSummary,
} from "../domain/server/diagnostics";
import type { SkillMetadata } from "../domain/catalog/metadata";
import type {
  ToolInventoryApp,
  ToolInventoryMarketplaceError,
  ToolInventoryPlugin,
  ToolInventorySnapshot,
} from "../domain/server/tool-inventory";
import { listSkillCatalog } from "./catalog";
import type { AppServerClient } from "./connection/client";
import { toolInventoryAppsFromAppInfos, toolInventoryPluginsFromInstalledResponse } from "./protocol/tool-inventory";

const APP_PAGE_LIMIT = 100;
const APP_PAGE_LOOP_LIMIT = 20;
const PLUGIN_DETAILS_CONCURRENCY = 4;

export interface ReadToolInventoryOptions {
  readonly threadId?: string | null;
  readonly mcpDiagnostics?: readonly McpServerDiagnostic[];
  readonly cachedSkills?: readonly SkillMetadata[];
  readonly cachedSkillsProbe?: DiagnosticProbeResult;
}

export interface ReadToolInventoryResult {
  readonly inventory: ToolInventorySnapshot;
  readonly probes: readonly DiagnosticProbeResult[];
  readonly mcpServerStatuses: readonly McpServerStatusSummary[] | null;
}

export async function readToolInventory(
  client: AppServerClient,
  cwd: string,
  options: ReadToolInventoryOptions = {},
): Promise<ReadToolInventoryResult> {
  const checkedAt = Date.now();
  const [apps, plugins, mcp, skills] = await Promise.all([
    readApps(client, options.threadId ?? null, checkedAt),
    readPlugins(client, cwd, checkedAt),
    readMcpServers(client, options.threadId ?? null, checkedAt),
    options.cachedSkills !== undefined
      ? Promise.resolve(readCachedSkills(options.cachedSkills, options.cachedSkillsProbe, checkedAt))
      : readSkills(client, cwd, checkedAt),
  ]);

  return {
    inventory: {
      checkedAt,
      apps: apps.data,
      appsError: apps.error,
      plugins: plugins.data,
      pluginMarketplaceErrors: plugins.marketplaceErrors,
      pluginsError: plugins.error,
      mcpServers: mcp.data,
      mcpDiagnostics: options.mcpDiagnostics ?? [],
      mcpError: mcp.error,
      skills: skills.data,
      skillsError: skills.error,
    },
    probes: [apps.probe, plugins.probe, mcp.probe, skills.probe],
    mcpServerStatuses: mcp.data,
  };
}

function readCachedSkills(
  skills: readonly SkillMetadata[],
  probe: DiagnosticProbeResult | undefined,
  checkedAt: number,
): { data: ToolInventorySnapshot["skills"]; error: string | null; probe: DiagnosticProbeResult } {
  return {
    data: [...skills],
    error: null,
    probe: probe ?? diagnosticProbeOk("skills/list", `${String(skills.length)} skills`, checkedAt),
  };
}

async function readApps(
  client: AppServerClient,
  threadId: string | null,
  checkedAt: number,
): Promise<{ data: ToolInventoryApp[] | null; error: string | null; probe: DiagnosticProbeResult }> {
  try {
    const apps = await listAllApps(client, threadId);
    return {
      data: toolInventoryAppsFromAppInfos(apps),
      error: null,
      probe: diagnosticProbeOk("app/list", `${String(apps.length)} apps`, checkedAt),
    };
  } catch (error) {
    return { data: null, error: shortErrorMessage(error), probe: diagnosticProbeError("app/list", error, checkedAt) };
  }
}

async function listAllApps(
  client: AppServerClient,
  threadId: string | null,
): Promise<Awaited<ReturnType<AppServerClient["listApps"]>>["data"]> {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const apps: Awaited<ReturnType<AppServerClient["listApps"]>>["data"] = [];
  for (let page = 0; page < APP_PAGE_LOOP_LIMIT; page += 1) {
    const response = await client.listApps({
      limit: APP_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
      ...(threadId ? { threadId } : {}),
    });
    apps.push(...response.data);
    cursor = response.nextCursor;
    if (!cursor) return apps;
    if (seenCursors.has(cursor)) {
      throw new Error("Codex app-server returned a repeated app list cursor.");
    }
    seenCursors.add(cursor);
  }
  throw new Error("Codex app-server returned too many app list pages.");
}

async function readPlugins(
  client: AppServerClient,
  cwd: string,
  checkedAt: number,
): Promise<{
  data: ToolInventoryPlugin[] | null;
  marketplaceErrors: ToolInventoryMarketplaceError[];
  error: string | null;
  probe: DiagnosticProbeResult;
}> {
  try {
    const response = await client.listInstalledPlugins(cwd);
    const { plugins, marketplaceErrors } = toolInventoryPluginsFromInstalledResponse(response);
    const pluginsWithDetails = await mapLimit(plugins, PLUGIN_DETAILS_CONCURRENCY, (plugin) => readPluginDetails(client, plugin));
    return {
      data: pluginsWithDetails,
      marketplaceErrors,
      error: null,
      probe: diagnosticProbeOk("plugin/installed", `${String(plugins.length)} plugins`, checkedAt),
    };
  } catch (error) {
    return {
      data: null,
      marketplaceErrors: [],
      error: shortErrorMessage(error),
      probe: diagnosticProbeError("plugin/installed", error, checkedAt),
    };
  }
}

async function mapLimit<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function readPluginDetails(client: AppServerClient, plugin: ToolInventoryPlugin): Promise<ToolInventoryPlugin> {
  if (!isUsablePlugin(plugin)) return plugin;
  try {
    const response = await client.readPlugin(pluginReadParams(plugin));
    return {
      ...plugin,
      details: {
        skillCount: response.plugin.skills.length,
        hookCount: response.plugin.hooks.length,
        appCount: response.plugin.apps.length,
        mcpServerCount: response.plugin.mcpServers.length,
      },
      detailsError: null,
    };
  } catch (error) {
    return { ...plugin, details: null, detailsError: shortErrorMessage(error) };
  }
}

function pluginReadParams(plugin: ToolInventoryPlugin): Parameters<AppServerClient["readPlugin"]>[0] {
  if (plugin.marketplacePath) {
    return {
      pluginName: plugin.name,
      marketplacePath: plugin.marketplacePath,
    };
  }
  return {
    pluginName: plugin.name,
    remoteMarketplaceName: plugin.marketplaceName,
  };
}

function isUsablePlugin(plugin: ToolInventoryPlugin): boolean {
  return plugin.enabled && plugin.installed;
}

async function readMcpServers(
  client: AppServerClient,
  threadId: string | null,
  checkedAt: number,
): Promise<{ data: McpServerStatusSummary[] | null; error: string | null; probe: DiagnosticProbeResult }> {
  try {
    const response = await client.listMcpServerStatus({
      detail: "toolsAndAuthOnly",
      limit: 100,
      ...(threadId ? { threadId } : {}),
    });
    const data = mcpServerStatusSummariesFromStatuses(response.data);
    return {
      data,
      error: null,
      probe: diagnosticProbeOk("mcpServerStatus/list", mcpSummary(data), checkedAt),
    };
  } catch (error) {
    return {
      data: null,
      error: shortErrorMessage(error),
      probe: diagnosticProbeError("mcpServerStatus/list", error, checkedAt),
    };
  }
}

function mcpSummary(servers: readonly McpServerStatusSummary[]): string {
  const issueCount = servers.filter((server) => server.authStatus === "notLoggedIn").length;
  return issueCount > 0 ? `${String(servers.length)} servers, ${String(issueCount)} auth issues` : `${String(servers.length)} servers`;
}

async function readSkills(
  client: AppServerClient,
  cwd: string,
  checkedAt: number,
): Promise<{ data: ToolInventorySnapshot["skills"]; error: string | null; probe: DiagnosticProbeResult }> {
  try {
    const catalog = await listSkillCatalog(client, cwd, { enabledOnly: false });
    return {
      data: catalog.skills,
      error: null,
      probe: diagnosticProbeOk("skills/list", `${String(catalog.totalCount)} skills`, checkedAt),
    };
  } catch (error) {
    return { data: null, error: shortErrorMessage(error), probe: diagnosticProbeError("skills/list", error, checkedAt) };
  }
}

function shortErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

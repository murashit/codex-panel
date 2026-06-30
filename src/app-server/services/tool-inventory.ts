import type { SkillMetadata } from "../../domain/catalog/metadata";
import { type DiagnosticProbeResult, diagnosticProbeError, diagnosticProbeOk } from "../../domain/server/diagnostics";
import {
  type McpServerDiagnostic,
  type McpServerStatusSummary,
  mcpServerStatusSummariesFromStatuses,
} from "../../domain/server/mcp-status";
import type { ToolInventoryMarketplaceError, ToolInventoryPlugin, ToolInventorySnapshot } from "../../domain/server/tool-inventory";
import { toolInventoryPluginsFromInstalledResponse } from "../protocol/tool-inventory";
import { listSkillCatalog } from "./catalog";
import type { AppServerRequestClient } from "./request-client";

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
  client: AppServerRequestClient,
  cwd: string,
  options: ReadToolInventoryOptions = {},
): Promise<ReadToolInventoryResult> {
  const checkedAt = Date.now();
  // As of Codex CLI 0.142.3, app/list can enumerate the full app catalog and leave
  // app-server CPU-bound after returning. Keep diagnostics on MCP/plugin/skill data
  // until the app-list API can provide a cheap installed-or-enabled summary.
  const [plugins, mcp, skills] = await Promise.all([
    readPlugins(client, cwd, checkedAt),
    readMcpServers(client, options.threadId ?? null, checkedAt),
    options.cachedSkills !== undefined
      ? Promise.resolve(readCachedSkills(options.cachedSkills, options.cachedSkillsProbe, checkedAt))
      : readSkills(client, cwd, checkedAt),
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
      skills: skills.items,
      skillsError: skills.error,
    },
    probes: [plugins.probe, mcp.probe, skills.probe],
    mcpServerStatuses: mcp.items,
  };
}

function readCachedSkills(
  skills: readonly SkillMetadata[],
  probe: DiagnosticProbeResult | undefined,
  checkedAt: number,
): { items: ToolInventorySnapshot["skills"]; error: string | null; probe: DiagnosticProbeResult } {
  return {
    items: [...skills],
    error: null,
    probe: probe ?? diagnosticProbeOk("skills", `${String(skills.length)} skills`, checkedAt),
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
      error: shortErrorMessage(error),
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
    const response = await client.request("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
      limit: 100,
      ...(threadId ? { threadId } : {}),
    });
    const servers = mcpServerStatusSummariesFromStatuses(response.data);
    return {
      items: servers,
      error: null,
      probe: diagnosticProbeOk("mcpServers", mcpSummary(servers), checkedAt),
    };
  } catch (error) {
    return {
      items: null,
      error: shortErrorMessage(error),
      probe: diagnosticProbeError("mcpServers", error, checkedAt),
    };
  }
}

function mcpSummary(servers: readonly McpServerStatusSummary[]): string {
  const issueCount = servers.filter((server) => server.authStatus === "notLoggedIn").length;
  return issueCount > 0 ? `${String(servers.length)} servers, ${String(issueCount)} auth issues` : `${String(servers.length)} servers`;
}

async function readSkills(
  client: AppServerRequestClient,
  cwd: string,
  checkedAt: number,
): Promise<{ items: ToolInventorySnapshot["skills"]; error: string | null; probe: DiagnosticProbeResult }> {
  try {
    const catalog = await listSkillCatalog(client, cwd, { enabledOnly: false });
    return {
      items: catalog.skills,
      error: null,
      probe: diagnosticProbeOk("skills", `${String(catalog.totalCount)} skills`, checkedAt),
    };
  } catch (error) {
    return { items: null, error: shortErrorMessage(error), probe: diagnosticProbeError("skills", error, checkedAt) };
  }
}

function shortErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

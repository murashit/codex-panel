import type { SkillMetadata } from "../../../../domain/runtime/catalog";
import type { DiagnosticProbeResult } from "../../../../domain/runtime/diagnostics";
import {
  type McpServerDiagnostic,
  type McpServerStatusSummary,
  mcpServerRegistrationKey,
  type ToolInventoryPlugin,
  type ToolInventorySnapshot,
} from "../../../../domain/runtime/tool-inventory";
import type { ToolbarStatusRow as DiagnosticRow, ToolbarStatusSection as DiagnosticSection } from "../toolbar/model";

const TOOL_PROVIDERS_LABEL = "Tool providers";
const SKILL_SCOPE_GROUPS = {
  repo: { label: "Workspace", rank: 0 },
  user: { label: "Personal", rank: 1 },
  system: { label: "System", rank: 2 },
  admin: { label: "Admin", rank: 3 },
  unknown: { label: "Unknown", rank: 4 },
} as const;

export function toolInventoryDiagnosticSections(
  inventory: ToolInventorySnapshot | null,
  skills: { value: readonly SkillMetadata[]; probe: DiagnosticProbeResult },
): DiagnosticSection[] {
  const inventorySections = inventory
    ? toolInventorySnapshotSections(inventory)
    : [
        {
          title: TOOL_PROVIDERS_LABEL,
          rows: [{ label: TOOL_PROVIDERS_LABEL, value: "not loaded", level: "warning" as const }],
        },
      ];
  return [...inventorySections, { title: "Skills", rows: skillRows(skills.value, skills.probe, inventory?.plugins ?? []) }];
}

function toolInventorySnapshotSections(inventory: ToolInventorySnapshot): DiagnosticSection[] {
  return [
    { title: "Plugins", rows: pluginRows(inventory) },
    { title: TOOL_PROVIDERS_LABEL, rows: mcpToolProviderRows(inventory) },
  ];
}

function pluginRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  const failure: DiagnosticRow[] = inventory.pluginsError ? [{ label: "Refresh", value: inventory.pluginsError, level: "error" }] : [];
  if (!inventory.plugins) return [...failure, { label: "Plugins", value: "not loaded", level: "warning" }];

  if (inventory.pluginsError) failure.push({ label: "Plugins", value: "showing last known inventory", level: "warning" });
  const rows = inventory.plugins.filter((plugin) => plugin.installed).map(pluginRow);
  return [...failure, ...(rows.length > 0 ? rows : [{ label: "Plugins", value: "(none)" }])];
}

function pluginRow(plugin: ToolInventoryPlugin): DiagnosticRow {
  const version = plugin.localVersion ? `version ${plugin.localVersion}` : "version unknown";
  const status = pluginUnavailableLabel(plugin);
  return {
    label: plugin.displayName ?? plugin.name,
    value: status ? `${version}, ${status}` : version,
    level: status ? "warning" : "normal",
  };
}

function mcpToolProviderRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  const { mcpDiagnostics } = inventory;
  const failure = inventory.mcpError ? [{ label: "Refresh", value: inventory.mcpError, level: "error" as const }] : [];
  if (inventory.mcpServers === null && mcpDiagnostics.length === 0) {
    return [...failure, { label: TOOL_PROVIDERS_LABEL, value: "not loaded", level: "warning" }];
  }

  const diagnostics = new Map(mcpDiagnostics.map((diagnostic) => [mcpServerRegistrationKey(diagnostic), diagnostic]));
  const rows = (inventory.mcpServers ?? []).map((server) => {
    const key = mcpServerRegistrationKey(server);
    const diagnostic = diagnostics.get(key);
    diagnostics.delete(key);
    return mcpToolProviderRow(server, server, diagnostic);
  });
  for (const diagnostic of diagnostics.values()) rows.push(mcpToolProviderRow(diagnostic, undefined, diagnostic));
  return [...failure, ...rows.sort((left, right) => left.label.localeCompare(right.label))];
}

function mcpToolProviderRow(
  registration: McpServerDiagnostic | McpServerStatusSummary,
  server: McpServerStatusSummary | undefined,
  diagnostic: McpServerDiagnostic | undefined,
): DiagnosticRow {
  const label = registration.environmentId === null ? registration.name : `${registration.name} (${registration.environmentId})`;
  const connectionStatus = diagnostic?.connectionStatus ?? server?.connectionStatus ?? "unknown";
  const authStatus = server?.authStatus ?? diagnostic?.authStatus ?? "unknown";
  const toolCount = server?.toolCount ?? diagnostic?.toolCount;
  const level = mcpToolProviderLevel(connectionStatus, authStatus);
  const apps = server?.name === "codex_apps" && !server.toolDiscoveryFailed ? listSummary(server.codexAppIds ?? []) : null;
  if (apps !== null && level === "normal" && !diagnostic?.message && !diagnostic?.authenticationIssue) {
    return { label, value: apps, level };
  }

  const parts = [
    apps ?? "MCP server",
    mcpConnectionStatusLabel(connectionStatus, server !== undefined),
    `auth ${mcpAuthStatusLabel(authStatus)}`,
  ];
  if (server?.toolDiscoveryFailed) parts.push("tool discovery failed");
  else if (apps === null) parts.push(toolCount == null ? "tools unknown" : countLabel(toolCount, "tool"));
  if (diagnostic?.authenticationIssue === "reauthenticationRequired") parts.push("re-authentication required");
  if (diagnostic?.message) parts.push(diagnostic.message);
  return { label, value: parts.join(", "), level };
}

function mcpToolProviderLevel(
  connectionStatus: McpServerDiagnostic["connectionStatus"],
  authStatus: McpServerDiagnostic["authStatus"] | McpServerStatusSummary["authStatus"],
): NonNullable<DiagnosticRow["level"]> {
  if (connectionStatus === "failed") return "error";
  if (authStatus === "notLoggedIn" || connectionStatus === "authenticationRequired" || connectionStatus === "cancelled") {
    return "warning";
  }
  return "normal";
}

function mcpConnectionStatusLabel(status: McpServerDiagnostic["connectionStatus"], configuredWhenUnknown: boolean): string {
  switch (status) {
    case "unknown":
      return configuredWhenUnknown ? "configured" : "connection unknown";
    case "notStarted":
      return "not started";
    case "authenticationRequired":
      return "authentication required";
    default:
      return status;
  }
}

function mcpAuthStatusLabel(status: NonNullable<McpServerDiagnostic["authStatus"]>): string {
  switch (status) {
    case "notLoggedIn":
      return "not logged in";
    case "bearerToken":
      return "bearer token";
    case "oAuth":
      return "OAuth";
    default:
      return status;
  }
}

function skillRows(
  skills: readonly SkillMetadata[],
  probe: DiagnosticProbeResult,
  plugins: readonly ToolInventoryPlugin[],
): DiagnosticRow[] {
  if (probe.status === "failed") return [{ label: "Skills", value: probe.message, level: "error" }];
  if (probe.status === "unknown") return [{ label: "Skills", value: "not loaded", level: "warning" }];

  const pluginsById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const groups = new Map<string, { label: string; rank: number; names: string[] }>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const key = skill.pluginId === null ? skill.scope : `plugin:${skill.pluginId}`;
    let group = groups.get(key);
    if (!group) {
      const plugin = skill.pluginId === null ? null : pluginsById.get(skill.pluginId);
      const provenance =
        skill.pluginId === null
          ? SKILL_SCOPE_GROUPS[skill.scope]
          : { label: plugin?.displayName ?? plugin?.name ?? skill.pluginId, rank: 5 };
      group = { ...provenance, names: [] };
      groups.set(key, group);
    }
    group.names.push(skill.name);
  }

  if (groups.size === 0) return [{ label: "Skills", value: "(none)" }];

  return [...groups.values()]
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))
    .map((group) => ({ label: group.label, value: listSummary(group.names) }));
}

function pluginUnavailableLabel(plugin: ToolInventoryPlugin): string | null {
  switch (plugin.unavailableReason) {
    case "admin":
      return "disabled by administrator";
    case "plan":
      return "unavailable on this plan";
    case "requiredApp":
      return "required app unavailable";
    case "unknown":
      return "disabled";
    case null:
      return plugin.enabled ? null : "disabled";
  }
}

function countLabel(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
}

function listSummary(names: readonly string[]): string {
  const sortedNames = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  return sortedNames.length > 0 ? sortedNames.join(", ") : "(none)";
}

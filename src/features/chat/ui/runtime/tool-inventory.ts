import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { DiagnosticProbeResult } from "../../../../domain/server/diagnostics";
import type { McpServerDiagnostic, McpServerStatusSummary } from "../../../../domain/server/mcp-status";
import type { ToolInventoryPlugin, ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { ToolbarStatusRow as DiagnosticRow, ToolbarStatusSection as DiagnosticSection } from "../toolbar/model";

const PERSONAL_SKILLS_LABEL = "Personal";
const SYSTEM_SKILLS_LABEL = "System";
const TOOL_PROVIDERS_LABEL = "Tool providers";
const WORKSPACE_SKILLS_FALLBACK_LABEL = "Workspace";
const SKILL_PROVENANCE_RANKS = {
  workspace: 0,
  personal: 1,
  system: 2,
  plugin: 3,
} as const;

type SkillProvenanceRank = (typeof SKILL_PROVENANCE_RANKS)[keyof typeof SKILL_PROVENANCE_RANKS];

interface SkillProvenance {
  label: string;
  rank: SkillProvenanceRank;
}

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
  return [...inventorySections, { title: "Skills", rows: skillRows(skills.value, skills.probe) }];
}

function toolInventorySnapshotSections(inventory: ToolInventorySnapshot): DiagnosticSection[] {
  return [
    { title: "Plugins", rows: pluginRows(inventory) },
    { title: TOOL_PROVIDERS_LABEL, rows: mcpToolProviderRows(inventory) },
  ];
}

function pluginRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  const failure = inventory.pluginsError ? [{ label: "Refresh", value: inventory.pluginsError, level: "error" as const }] : [];
  if (!inventory.plugins) return [...failure, { label: "Plugins", value: "not loaded", level: "warning" }];

  const rows = inventory.plugins.filter((plugin) => plugin.enabled && plugin.installed).map(pluginRow);
  return [...failure, ...(rows.length > 0 ? rows : [{ label: "Plugins", value: "(none)" }])];
}

function pluginRow(plugin: ToolInventoryPlugin): DiagnosticRow {
  return {
    label: plugin.displayName ?? plugin.name,
    value: pluginBundleSummary(plugin),
    level: "normal",
  };
}

function mcpToolProviderRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  const { mcpDiagnostics } = inventory;
  const failure = inventory.mcpError ? [{ label: "Refresh", value: inventory.mcpError, level: "error" as const }] : [];
  if (inventory.mcpServers === null && mcpDiagnostics.length === 0) {
    return [...failure, { label: TOOL_PROVIDERS_LABEL, value: "not loaded", level: "warning" }];
  }

  const statusByName = new Map((inventory.mcpServers ?? []).map((server) => [server.name, server]));
  const diagnosticByName = new Map(mcpDiagnostics.map((diagnostic) => [diagnostic.name, diagnostic]));
  const names = new Set([...statusByName.keys(), ...diagnosticByName.keys()]);
  const rows = [...names].map((name) => {
    const server = statusByName.get(name);
    const diagnostic = diagnosticByName.get(name);
    return mcpToolProviderRow(name, server, diagnostic);
  });
  return [...failure, ...rows.sort((left, right) => left.label.localeCompare(right.label))];
}

function mcpToolProviderRow(
  name: string,
  server: McpServerStatusSummary | undefined,
  diagnostic: McpServerDiagnostic | undefined,
): DiagnosticRow {
  const connectionStatus = diagnostic?.connectionStatus ?? server?.connectionStatus ?? "unknown";
  const authStatus = server?.authStatus ?? diagnostic?.authStatus ?? "unknown";
  const toolCount = server?.toolCount ?? diagnostic?.toolCount;
  const level = mcpToolProviderLevel(connectionStatus, authStatus);
  const apps = server?.name === "codex_apps" && !server.toolDiscoveryFailed ? listSummary(server.codexAppIds ?? []) : null;
  if (apps !== null && level === "normal" && !diagnostic?.message && !diagnostic?.authenticationIssue) {
    return { label: name, value: apps, level };
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
  return { label: name, value: parts.join(", "), level };
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

function skillRows(skills: readonly SkillMetadata[], probe: DiagnosticProbeResult): DiagnosticRow[] {
  if (probe.status === "failed") return [{ label: "Skills", value: probe.message ?? "unavailable", level: "error" }];
  if (probe.status === "unknown") return [{ label: "Skills", value: "not loaded", level: "warning" }];

  const groups = new Map<string, SkillProvenance & { names: string[] }>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const provenance = skillProvenance(skill);
    const group = groups.get(provenance.label) ?? { ...provenance, names: [] };
    group.rank = provenance.rank;
    group.names.push(skillDisplayName(skill));
    groups.set(provenance.label, group);
  }

  if (groups.size === 0) return [{ label: "Skills", value: "(none)" }];

  return [...groups.values()]
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))
    .map((group) => ({ label: group.label, value: listSummary(group.names) }));
}

function pluginBundleSummary(plugin: ToolInventoryPlugin): string {
  return plugin.localVersion ? `version ${plugin.localVersion}` : "version unknown";
}

function countLabel(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
}

function skillDisplayName(skill: SkillMetadata): string {
  const prefixSeparator = skill.name.indexOf(":");
  if (prefixSeparator > 0 && prefixSeparator < skill.name.length - 1) return skill.name.slice(prefixSeparator + 1);
  return skill.name;
}

function skillProvenance(skill: SkillMetadata): SkillProvenance {
  const prefixSeparator = skill.name.indexOf(":");
  if (prefixSeparator > 0) return { label: pluginLabel(skill.name.slice(0, prefixSeparator)), rank: SKILL_PROVENANCE_RANKS.plugin };

  const path = normalizedPath(skill.path);
  if (path.includes("/.codex/skills/.system/")) return { label: SYSTEM_SKILLS_LABEL, rank: SKILL_PROVENANCE_RANKS.system };

  const pluginCacheMarker = "/plugins/cache/";
  const pluginCacheIndex = path.indexOf(pluginCacheMarker);
  if (pluginCacheIndex >= 0) {
    const pluginCachePath = path.slice(pluginCacheIndex + pluginCacheMarker.length);
    const parts = pluginCachePath.split("/").filter(Boolean);
    return { label: pluginLabel(parts[1] ?? parts[0] ?? "plugin"), rank: SKILL_PROVENANCE_RANKS.plugin };
  }

  const workspaceRoot = skillWorkspaceRoot(path);
  if (!workspaceRoot) return { label: WORKSPACE_SKILLS_FALLBACK_LABEL, rank: SKILL_PROVENANCE_RANKS.workspace };
  if (isPersonalSkillRoot(workspaceRoot)) return { label: PERSONAL_SKILLS_LABEL, rank: SKILL_PROVENANCE_RANKS.personal };

  return { label: basename(workspaceRoot) || WORKSPACE_SKILLS_FALLBACK_LABEL, rank: SKILL_PROVENANCE_RANKS.workspace };
}

function listSummary(names: readonly string[]): string {
  const sortedNames = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  return sortedNames.length > 0 ? sortedNames.join(", ") : "(none)";
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function skillWorkspaceRoot(path: string): string | null {
  for (const marker of ["/.codex/skills/", "/.agents/skills/"]) {
    const markerIndex = path.indexOf(marker);
    if (markerIndex >= 0) return path.slice(0, markerIndex);
  }
  return null;
}

function isPersonalSkillRoot(root: string): boolean {
  const parts = root.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "root") return true;
  if (parts.length === 2 && (parts[0] === "Users" || parts[0] === "home")) return true;
  if (parts.length === 3 && parts[1] === "Users") return true;
  return false;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function pluginLabel(name: string): string {
  const canonicalLabels: Record<string, string> = {
    browser: "Browser",
    github: "GitHub",
    gmail: "Gmail",
    "google-drive": "Google Drive",
    pdf: "PDF",
    slack: "Slack",
  };
  return canonicalLabels[name] ?? name.split("-").filter(Boolean).map(capitalize).join(" ");
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { Diagnostics, McpServerDiagnostic, McpServerStatusSummary } from "../../../../domain/server/diagnostics";
import type { ToolInventoryApp, ToolInventoryPlugin, ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { DiagnosticRow, DiagnosticSection } from "./diagnostic-sections";

const PERSONAL_SKILLS_LABEL = "Personal";
const SYSTEM_SKILLS_LABEL = "System";
const WORKSPACE_SKILLS_FALLBACK_LABEL = "Workspace";
const CODEX_APPS_PROVIDER_LABEL = "codex_apps";
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

function toolInventorySections(inventory: ToolInventorySnapshot | null): DiagnosticSection[] {
  if (!inventory) {
    const row = { label: "Codex capabilities", value: "not loaded", level: "warning" as const };
    return [{ title: "Tool providers", rows: [row] }];
  }

  return toolInventorySnapshotSections(inventory);
}

export function toolInventoryDiagnosticSections(diagnostics: Pick<Diagnostics, "toolInventory" | "mcpServers">): DiagnosticSection[] {
  if (!diagnostics.toolInventory) return toolInventorySections(null);
  return toolInventorySnapshotSections({
    ...diagnostics.toolInventory,
    mcpDiagnostics: diagnostics.mcpServers,
  });
}

function toolInventorySnapshotSections(inventory: ToolInventorySnapshot): DiagnosticSection[] {
  return [
    { title: "Plugins", rows: pluginRows(inventory) },
    { title: "Tool providers", rows: toolProviderRows(inventory) },
    { title: "Skills", rows: skillRows(inventory) },
  ];
}

function pluginRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  if (inventory.pluginsError) return [{ label: "Plugins", value: inventory.pluginsError, level: "error" }];
  if (!inventory.plugins) return [{ label: "Plugins", value: "not loaded", level: "warning" }];

  const rows = inventory.plugins.filter(isUsablePlugin).map(pluginRow);
  return rows.length > 0 ? rows : [{ label: "Plugins", value: "(none)" }];
}

function pluginRow(plugin: ToolInventoryPlugin): DiagnosticRow {
  return {
    label: plugin.displayName ?? plugin.name,
    value: pluginBundleSummary(plugin),
    level: plugin.detailsError ? "warning" : "normal",
  };
}

function toolProviderRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  const rows = mcpToolProviderRows(inventory).sort((left, right) => left.label.localeCompare(right.label));
  return [codexAppsProviderRow(inventory), ...rows];
}

function codexAppsProviderRow(inventory: ToolInventorySnapshot): DiagnosticRow {
  if (inventory.appsError) return { label: CODEX_APPS_PROVIDER_LABEL, value: inventory.appsError, level: "error" };
  if (!inventory.apps) return { label: CODEX_APPS_PROVIDER_LABEL, value: "not loaded", level: "warning" };
  return { label: CODEX_APPS_PROVIDER_LABEL, value: listSummary(inventory.apps.filter(isUsableApp).map((app) => app.name)) };
}

function mcpToolProviderRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  if (inventory.mcpError) return [{ label: "MCP servers", value: inventory.mcpError, level: "error" }];
  if (inventory.mcpServers === null && inventory.mcpDiagnostics.length === 0) {
    return [{ label: "MCP servers", value: "not loaded", level: "warning" }];
  }

  const statusByName = new Map((inventory.mcpServers ?? []).map((server) => [server.name, server]));
  const diagnosticByName = new Map(inventory.mcpDiagnostics.map((diagnostic) => [diagnostic.name, diagnostic]));
  const names = new Set([...statusByName.keys(), ...diagnosticByName.keys()]);
  return [...names].flatMap((name) => {
    if (name === CODEX_APPS_PROVIDER_LABEL) return [];
    const server = statusByName.get(name);
    const diagnostic = diagnosticByName.get(name);
    return [server ? mcpToolProviderStatusRow(server, diagnostic) : mcpToolProviderDiagnosticRow(name, diagnostic)];
  });
}

function mcpToolProviderStatusRow(server: McpServerStatusSummary, diagnostic: McpServerDiagnostic | undefined): DiagnosticRow {
  const startup = diagnostic?.startupStatus && diagnostic.startupStatus !== "unknown" ? diagnostic.startupStatus : "available";
  const parts = [
    "MCP server",
    startup,
    `auth ${server.authStatus}`,
    countLabel(server.toolCount, "tool"),
    countLabel(server.resourceCount, "resource"),
  ];
  if (server.resourceTemplateCount > 0) parts.push(countLabel(server.resourceTemplateCount, "resource template"));
  if (diagnostic?.message) parts.push(diagnostic.message);
  return {
    label: server.name,
    value: parts.join(", "),
    level: mcpToolProviderLevel(diagnostic, server.authStatus),
  };
}

function mcpToolProviderDiagnosticRow(name: string, diagnostic: McpServerDiagnostic | undefined): DiagnosticRow {
  const startup = diagnostic?.startupStatus ?? "unknown";
  const auth = diagnostic?.authStatus ? `auth ${diagnostic.authStatus}` : "auth unknown";
  const tools =
    diagnostic?.toolCount === null || diagnostic?.toolCount === undefined ? "tools unknown" : countLabel(diagnostic.toolCount, "tool");
  const parts = ["MCP server", startup, auth, tools];
  if (diagnostic?.message) parts.push(diagnostic.message);
  return {
    label: name,
    value: parts.join(", "),
    level: mcpToolProviderLevel(diagnostic, diagnostic?.authStatus ?? null),
  };
}

function mcpToolProviderLevel(
  diagnostic: McpServerDiagnostic | undefined,
  authStatus: McpServerDiagnostic["authStatus"] | McpServerStatusSummary["authStatus"],
): NonNullable<DiagnosticRow["level"]> {
  if (diagnostic?.startupStatus === "failed") return "error";
  if (authStatus === "notLoggedIn" || diagnostic?.startupStatus === "cancelled") return "warning";
  return "normal";
}

function skillRows(inventory: ToolInventorySnapshot): DiagnosticRow[] {
  if (inventory.skillsError) return [{ label: "Skills", value: inventory.skillsError, level: "error" }];
  if (!inventory.skills) return [{ label: "Skills", value: "not loaded", level: "warning" }];

  const skillsByProvenance = new Map<string, Set<string>>();
  const provenanceRanks = new Map<string, SkillProvenanceRank>();
  for (const skill of inventory.skills) {
    if (!skill.enabled) continue;
    const provenance = skillProvenance(skill);
    const skills = skillsByProvenance.get(provenance.label) ?? new Set<string>();
    skills.add(skillDisplayName(skill));
    skillsByProvenance.set(provenance.label, skills);
    provenanceRanks.set(provenance.label, provenance.rank);
  }

  if (skillsByProvenance.size === 0) return [{ label: "Skills", value: "(none)" }];

  return [...skillsByProvenance.entries()]
    .sort(([left], [right]) => compareSkillProvenance(left, right, provenanceRanks))
    .map(([provenance, skills]) => ({ label: provenance, value: listSummary([...skills]) }));
}

function isUsableApp(app: ToolInventoryApp): boolean {
  return app.enabled && app.accessible;
}

function isUsablePlugin(plugin: ToolInventoryPlugin): boolean {
  return plugin.enabled && plugin.installed;
}

function pluginBundleSummary(plugin: ToolInventoryPlugin): string {
  if (plugin.detailsError) return "details unavailable";
  if (!plugin.details) return "details not loaded";

  const parts = [
    countPart(plugin.details.skillCount, "skill"),
    countPart(plugin.details.hookCount, "hook"),
    countPart(plugin.details.appCount, "app"),
    countPart(plugin.details.mcpServerCount, "MCP server"),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "no listed items";
}

function countPart(count: number, singular: string): string | null {
  if (count === 0) return null;
  return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
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

function compareSkillProvenance(left: string, right: string, ranks: ReadonlyMap<string, SkillProvenanceRank>): number {
  const leftRank = ranks.get(left) ?? SKILL_PROVENANCE_RANKS.plugin;
  const rightRank = ranks.get(right) ?? SKILL_PROVENANCE_RANKS.plugin;
  return leftRank - rightRank || left.localeCompare(right);
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

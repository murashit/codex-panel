import type { SkillMetadata } from "../catalog/metadata";
import type { McpServerDiagnostic, McpServerStatusSummary } from "./diagnostics";

export interface ToolInventoryPlugin {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly marketplaceName: string;
  readonly marketplacePath: string | null;
  readonly localVersion: string | null;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly availability: string;
  readonly source: string;
  readonly details: {
    readonly skillCount: number;
    readonly hookCount: number;
    readonly appCount: number;
    readonly mcpServerCount: number;
  } | null;
  readonly detailsError: string | null;
}

export interface ToolInventoryMarketplaceError {
  readonly marketplacePath: string;
  readonly message: string;
}

export interface ToolInventorySnapshot {
  readonly checkedAt: number;
  readonly plugins: readonly ToolInventoryPlugin[] | null;
  readonly pluginMarketplaceErrors: readonly ToolInventoryMarketplaceError[];
  readonly pluginsError: string | null;
  readonly mcpServers: readonly McpServerStatusSummary[] | null;
  readonly mcpDiagnostics: readonly McpServerDiagnostic[];
  readonly mcpError: string | null;
  readonly skills: readonly SkillMetadata[] | null;
  readonly skillsError: string | null;
}

export function cloneToolInventorySnapshot(snapshot: ToolInventorySnapshot): ToolInventorySnapshot {
  return {
    ...snapshot,
    plugins: snapshot.plugins
      ? snapshot.plugins.map((plugin) => ({ ...plugin, details: plugin.details ? { ...plugin.details } : null }))
      : null,
    pluginMarketplaceErrors: snapshot.pluginMarketplaceErrors.map((error) => ({ ...error })),
    mcpServers: snapshot.mcpServers ? snapshot.mcpServers.map((server) => ({ ...server })) : null,
    mcpDiagnostics: snapshot.mcpDiagnostics.map((diagnostic) => ({ ...diagnostic })),
    skills: snapshot.skills ? snapshot.skills.map((skill) => ({ ...skill })) : null,
  };
}

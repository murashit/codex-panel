import { cloneMcpServerDiagnostic, cloneMcpServerStatusSummary, type McpServerDiagnostic, type McpServerStatusSummary } from "./mcp-status";

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
}

export interface ToolInventorySnapshot {
  readonly plugins: readonly ToolInventoryPlugin[] | null;
  readonly pluginsError: string | null;
  readonly mcpServers: readonly McpServerStatusSummary[] | null;
  readonly mcpDiagnostics: readonly McpServerDiagnostic[];
  readonly mcpError: string | null;
}

export function cloneToolInventorySnapshot(snapshot: ToolInventorySnapshot): ToolInventorySnapshot {
  return {
    ...snapshot,
    plugins: snapshot.plugins ? snapshot.plugins.map((plugin) => ({ ...plugin })) : null,
    mcpServers: snapshot.mcpServers ? snapshot.mcpServers.map(cloneMcpServerStatusSummary) : null,
    mcpDiagnostics: snapshot.mcpDiagnostics.map(cloneMcpServerDiagnostic),
  };
}

type McpAuthStatus = "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";

export type McpServerStartupStatus = "starting" | "ready" | "failed" | "cancelled";
export type McpServerConnectionStatus =
  | "unknown"
  | "notStarted"
  | "starting"
  | "connected"
  | "authenticationRequired"
  | "failed"
  | "cancelled"
  | "disabled";
export type McpServerAuthenticationIssue = "reauthenticationRequired";

export interface McpServerDiagnostic {
  readonly name: string;
  readonly connectionStatus: McpServerConnectionStatus;
  readonly authStatus: McpAuthStatus | null;
  readonly toolCount: number | null;
  readonly message: string | null;
  readonly authenticationIssue: McpServerAuthenticationIssue | null;
}

export interface McpServerStatusSummary {
  readonly name: string;
  readonly authStatus: McpAuthStatus;
  readonly toolCount: number;
  readonly toolDiscoveryFailed: boolean;
  readonly connectionStatus: Exclude<McpServerConnectionStatus, "unknown"> | null;
  readonly codexAppIds?: readonly string[];
}

export function mcpConnectionStatusFromStartupStatus(status: McpServerStartupStatus): McpServerConnectionStatus {
  return status === "ready" ? "connected" : status;
}

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

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
  readonly connectionStatus: Exclude<McpServerConnectionStatus, "unknown"> | null;
  readonly codexAppIds?: readonly string[];
}

export function mcpConnectionStatusFromStartupStatus(status: McpServerStartupStatus): McpServerConnectionStatus {
  return status === "ready" ? "connected" : status;
}

export function cloneMcpServerStatusSummary(server: McpServerStatusSummary): McpServerStatusSummary {
  return server.codexAppIds ? { ...server, codexAppIds: [...server.codexAppIds] } : { ...server };
}

export function cloneMcpServerDiagnostic(server: McpServerDiagnostic): McpServerDiagnostic {
  return { ...server };
}

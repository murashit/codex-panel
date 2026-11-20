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

export interface McpServerRegistration {
  readonly name: string;
  readonly environmentId: string | null;
}

export function mcpServerRegistrationLabel({ name, environmentId }: McpServerRegistration): string {
  return environmentId === null ? name : `${name} (${environmentId})`;
}

export function mcpServerRegistrationKey(server: McpServerRegistration): string {
  return JSON.stringify([server.name, server.environmentId]);
}

export interface McpServerDiagnostic extends McpServerRegistration {
  readonly connectionStatus: Exclude<McpServerStartupStatus, "ready"> | "connected";
  readonly message: string | null;
  readonly authenticationIssue: McpServerAuthenticationIssue | null;
}

export interface McpServerStatusSummary extends McpServerRegistration {
  readonly authStatus: McpAuthStatus;
  readonly toolCount: number;
  readonly toolDiscoveryFailed: boolean;
  readonly connectionStatus: Exclude<McpServerConnectionStatus, "unknown"> | null;
  readonly codexAppIds?: readonly string[];
}

export interface ToolInventoryPlugin {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly localVersion: string | null;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly unavailableReason: "admin" | "plan" | "requiredApp" | "unknown" | null;
}

export interface ToolInventorySnapshot {
  readonly plugins: readonly ToolInventoryPlugin[] | null;
  readonly pluginsError: string | null;
  readonly mcpServers: readonly McpServerStatusSummary[] | null;
  readonly mcpDiagnostics: readonly McpServerDiagnostic[];
  readonly mcpError: string | null;
}

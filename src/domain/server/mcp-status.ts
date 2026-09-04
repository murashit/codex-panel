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

export interface McpServerStatus {
  readonly name: string;
  readonly tools: Readonly<Record<string, unknown>>;
  readonly resources: readonly unknown[];
  readonly resourceTemplates: readonly unknown[];
  readonly authStatus: McpAuthStatus;
  readonly runtimeStatus: Exclude<McpServerConnectionStatus, "unknown"> | null;
}

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

export function mcpServerStatusSummariesFromStatuses(servers: readonly McpServerStatus[]): McpServerStatusSummary[] {
  return servers.map(mcpServerStatusSummaryFromStatus);
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

function mcpServerStatusSummaryFromStatus(server: McpServerStatus): McpServerStatusSummary {
  return {
    name: server.name,
    authStatus: server.authStatus,
    toolCount: Object.keys(server.tools).length,
    connectionStatus: server.runtimeStatus,
    codexAppIds: server.name === "codex_apps" ? codexAppIdsFromTools(server.tools) : [],
  };
}

function codexAppIdsFromTools(tools: Readonly<Record<string, unknown>>): string[] {
  const appIds = new Set<string>();
  for (const [toolKey, tool] of Object.entries(tools)) {
    const toolName = toolNameFromStatusTool(tool) ?? toolKey;
    const prefixSeparator = toolName.indexOf(".");
    if (prefixSeparator <= 0) continue;
    appIds.add(toolName.slice(0, prefixSeparator));
  }
  return [...appIds].sort((left, right) => left.localeCompare(right));
}

function toolNameFromStatusTool(tool: unknown): string | null {
  if (!tool || typeof tool !== "object") return null;
  const name = (tool as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

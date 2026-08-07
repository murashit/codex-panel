type McpAuthStatus = "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";

export type McpServerStartupStatus = "starting" | "ready" | "failed" | "cancelled";

export interface McpServerStatus {
  readonly name: string;
  readonly tools: Readonly<Record<string, unknown>>;
  readonly resources: readonly unknown[];
  readonly resourceTemplates: readonly unknown[];
  readonly authStatus: McpAuthStatus;
}

export interface McpServerDiagnostic {
  readonly name: string;
  readonly startupStatus: McpServerStartupStatus | "unknown";
  readonly authStatus: McpAuthStatus | null;
  readonly toolCount: number | null;
  readonly message: string | null;
}

export interface McpServerStatusSummary {
  readonly name: string;
  readonly authStatus: McpAuthStatus;
  readonly toolCount: number;
  readonly resourceCount: number;
  readonly resourceTemplateCount: number;
  readonly codexAppIds?: readonly string[];
}

export function mcpServerStatusSummariesFromStatuses(servers: readonly McpServerStatus[]): McpServerStatusSummary[] {
  return servers.map(mcpServerStatusSummaryFromStatus);
}

export function mcpServerDiagnosticFromStatus(server: McpServerStatusSummary): McpServerDiagnostic {
  return {
    name: server.name,
    startupStatus: "unknown",
    authStatus: server.authStatus,
    toolCount: server.toolCount,
    message: null,
  };
}

export function cloneMcpServerStatusSummary(server: McpServerStatusSummary): McpServerStatusSummary {
  return server.codexAppIds ? { ...server, codexAppIds: [...server.codexAppIds] } : { ...server };
}

function mcpServerStatusSummaryFromStatus(server: McpServerStatus): McpServerStatusSummary {
  return {
    name: server.name,
    authStatus: server.authStatus,
    toolCount: Object.keys(server.tools).length,
    resourceCount: server.resources.length,
    resourceTemplateCount: server.resourceTemplates.length,
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

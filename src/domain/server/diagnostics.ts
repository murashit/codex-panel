import type { ServerInitialization } from "./initialization";
import { cloneToolInventorySnapshot, type ToolInventorySnapshot } from "./tool-inventory";

const DIAGNOSTIC_PROBE_METHODS = [
  "model/list",
  "skills/list",
  "app/list",
  "plugin/installed",
  "account/rateLimits/read",
  "mcpServerStatus/list",
] as const;

export type DiagnosticProbeMethod = (typeof DIAGNOSTIC_PROBE_METHODS)[number];
type DiagnosticProbeStatus = "unknown" | "ok" | "failed";
type McpAuthStatus = "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
export type McpServerStartupStatus = "starting" | "ready" | "failed" | "cancelled";

export interface McpServerStatus {
  readonly name: string;
  readonly tools: Readonly<Record<string, unknown>>;
  readonly resources: readonly unknown[];
  readonly resourceTemplates: readonly unknown[];
  readonly authStatus: McpAuthStatus;
}

export interface DiagnosticProbeResult {
  readonly method: DiagnosticProbeMethod;
  readonly status: DiagnosticProbeStatus;
  readonly message: string | null;
  readonly summary: string | null;
  readonly checkedAt: number | null;
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

export interface Diagnostics {
  readonly probes: Readonly<Record<DiagnosticProbeMethod, DiagnosticProbeResult>>;
  readonly mcpServers: readonly McpServerDiagnostic[];
  readonly toolInventory: ToolInventorySnapshot | null;
}

export function createServerDiagnostics(): Diagnostics {
  return {
    probes: Object.fromEntries(DIAGNOSTIC_PROBE_METHODS.map((method) => [method, createDiagnosticProbeResult(method)])) as Record<
      DiagnosticProbeMethod,
      DiagnosticProbeResult
    >,
    mcpServers: [],
    toolInventory: null,
  };
}

export function cloneServerDiagnostics(diagnostics: Diagnostics): Diagnostics {
  return {
    probes: { ...diagnostics.probes },
    mcpServers: diagnostics.mcpServers.map((server) => ({ ...server })),
    toolInventory: diagnostics.toolInventory ? cloneToolInventorySnapshot(diagnostics.toolInventory) : null,
  };
}

export function diagnosticsWithProbe(diagnostics: Diagnostics, probe: DiagnosticProbeResult): Diagnostics {
  return {
    ...diagnostics,
    probes: {
      ...diagnostics.probes,
      [probe.method]: probe,
    },
  };
}

export function diagnosticsWithToolInventory(diagnostics: Diagnostics, toolInventory: ToolInventorySnapshot | null): Diagnostics {
  return {
    ...diagnostics,
    toolInventory: toolInventory ? cloneToolInventorySnapshot(toolInventory) : null,
  };
}

function createDiagnosticProbeResult(method: DiagnosticProbeMethod): DiagnosticProbeResult {
  return {
    method,
    status: "unknown",
    message: null,
    summary: null,
    checkedAt: null,
  };
}

export function diagnosticProbeOk(method: DiagnosticProbeMethod, summary: string | null, checkedAt: number): DiagnosticProbeResult {
  return {
    method,
    status: "ok",
    message: null,
    summary,
    checkedAt,
  };
}

export function diagnosticProbeError(method: DiagnosticProbeMethod, error: unknown, checkedAt: number): DiagnosticProbeResult {
  return {
    method,
    status: "failed",
    message: shortErrorMessage(error),
    summary: null,
    checkedAt,
  };
}

export function serverIdentity(initializeResponse: ServerInitialization | null): string {
  return initializeResponse?.userAgent ?? "(not connected)";
}

export function serverPlatform(initializeResponse: ServerInitialization | null): string {
  if (!initializeResponse) return "(not connected)";
  const family = initializeResponse.platformFamily;
  const os = initializeResponse.platformOs;
  return `${os}/${family}`;
}

export function upsertMcpServerDiagnostic(diagnostics: Diagnostics, server: McpServerDiagnostic): Diagnostics {
  const current = diagnostics.mcpServers.find((item) => item.name === server.name);
  const merged = mergeMcpServerDiagnostic(current, server);
  const existing = diagnostics.mcpServers.filter((item) => item.name !== server.name);
  return {
    ...diagnostics,
    mcpServers: [...existing, merged].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function upsertMcpServerStatusDiagnostics(diagnostics: Diagnostics, servers: readonly McpServerStatusSummary[]): Diagnostics {
  let next = diagnostics;
  for (const server of servers) next = upsertMcpServerDiagnostic(next, mcpServerDiagnosticFromStatus(server));
  return next;
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

export function mcpServerStatusSummariesFromStatuses(servers: readonly McpServerStatus[]): McpServerStatusSummary[] {
  return servers.map(mcpServerStatusSummaryFromStatus);
}

function shortErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
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

function mcpServerDiagnosticFromStatus(server: McpServerStatusSummary): McpServerDiagnostic {
  return {
    name: server.name,
    startupStatus: "unknown",
    authStatus: server.authStatus,
    toolCount: server.toolCount,
    message: null,
  };
}

function mergeMcpServerDiagnostic(current: McpServerDiagnostic | undefined, update: McpServerDiagnostic): McpServerDiagnostic {
  const startupUpdated = update.startupStatus !== "unknown";
  return {
    name: update.name,
    startupStatus: startupUpdated ? update.startupStatus : (current?.startupStatus ?? "unknown"),
    authStatus: update.authStatus ?? current?.authStatus ?? null,
    toolCount: update.toolCount ?? current?.toolCount ?? null,
    message: update.message ?? (startupUpdated ? null : (current?.message ?? null)),
  };
}

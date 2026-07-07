import type { ServerInitialization } from "./initialization";
import { type McpServerDiagnostic, type McpServerStatusSummary, mcpServerDiagnosticFromStatus } from "./mcp-status";
import { cloneToolInventorySnapshot, type ToolInventorySnapshot } from "./tool-inventory";

const DIAGNOSTIC_PROBE_DEFINITIONS = {
  models: { label: "Models" },
  skills: { label: "Skills" },
  permissionProfiles: { label: "Permission profiles" },
  apps: { label: "Apps" },
  plugins: { label: "Plugins" },
  rateLimits: { label: "Rate limits" },
  mcpServers: { label: "MCP servers" },
} as const;

export type DiagnosticProbeId = keyof typeof DIAGNOSTIC_PROBE_DEFINITIONS;
type DiagnosticProbeStatus = "unknown" | "ok" | "failed";

export interface DiagnosticProbeResult {
  readonly id: DiagnosticProbeId;
  readonly status: DiagnosticProbeStatus;
  readonly message: string | null;
  readonly summary: string | null;
  readonly checkedAt: number | null;
}

export interface Diagnostics {
  readonly probes: Readonly<Record<DiagnosticProbeId, DiagnosticProbeResult>>;
  readonly mcpServers: readonly McpServerDiagnostic[];
  readonly toolInventory: ToolInventorySnapshot | null;
}

export function createServerDiagnostics(): Diagnostics {
  return {
    probes: Object.fromEntries(
      Object.keys(DIAGNOSTIC_PROBE_DEFINITIONS).map((id) => [id, createDiagnosticProbeResult(id as DiagnosticProbeId)]),
    ) as Record<DiagnosticProbeId, DiagnosticProbeResult>,
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
      [probe.id]: probe,
    },
  };
}

export function diagnosticsWithToolInventory(diagnostics: Diagnostics, toolInventory: ToolInventorySnapshot | null): Diagnostics {
  return {
    ...diagnostics,
    toolInventory: toolInventory ? cloneToolInventorySnapshot(toolInventory) : null,
  };
}

function createDiagnosticProbeResult(id: DiagnosticProbeId): DiagnosticProbeResult {
  return {
    id,
    status: "unknown",
    message: null,
    summary: null,
    checkedAt: null,
  };
}

export function diagnosticProbeOk(id: DiagnosticProbeId, summary: string | null, checkedAt: number): DiagnosticProbeResult {
  return {
    id,
    status: "ok",
    message: null,
    summary,
    checkedAt,
  };
}

export function diagnosticProbeError(id: DiagnosticProbeId, error: unknown, checkedAt: number): DiagnosticProbeResult {
  return {
    id,
    status: "failed",
    message: shortDiagnosticErrorMessage(error),
    summary: null,
    checkedAt,
  };
}

export function diagnosticProbeLabel(id: DiagnosticProbeId): string {
  return DIAGNOSTIC_PROBE_DEFINITIONS[id].label;
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

export function shortDiagnosticErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
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

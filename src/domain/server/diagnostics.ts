import type { ServerInitialization } from "./initialization";
import type { McpServerDiagnostic } from "./mcp-status";

const DIAGNOSTIC_PROBE_DEFINITIONS = {
  models: { label: "Models" },
  skills: { label: "Skills" },
  permissionProfiles: { label: "Permission profiles" },
  rateLimits: { label: "Rate limits" },
} as const;

const METADATA_RESOURCE_PROBE_IDS = ["models", "skills", "permissionProfiles", "rateLimits"] as const;

export type DiagnosticProbeId = keyof typeof DIAGNOSTIC_PROBE_DEFINITIONS;
type MetadataResourceProbeId = (typeof METADATA_RESOURCE_PROBE_IDS)[number];
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
}

export interface MetadataResourceDiagnostics {
  readonly probes: Readonly<Record<MetadataResourceProbeId, DiagnosticProbeResult>>;
}

export function createServerDiagnostics(): Diagnostics {
  return {
    probes: createMetadataResourceDiagnostics().probes,
    mcpServers: [],
  };
}

export function createMetadataResourceDiagnostics(): MetadataResourceDiagnostics {
  return {
    probes: Object.fromEntries(METADATA_RESOURCE_PROBE_IDS.map((id) => [id, createDiagnosticProbeResult(id)])) as Record<
      MetadataResourceProbeId,
      DiagnosticProbeResult
    >,
  };
}

export function serverDiagnostics(metadata: MetadataResourceDiagnostics, mcpServers: readonly McpServerDiagnostic[]): Diagnostics {
  return {
    probes: metadata.probes,
    mcpServers,
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

export function upsertMcpServerDiagnostic(
  diagnostics: readonly McpServerDiagnostic[],
  server: McpServerDiagnostic,
): readonly McpServerDiagnostic[] {
  const current = diagnostics.find((item) => item.name === server.name);
  const merged = mergeMcpServerDiagnostic(current, server);
  const existing = diagnostics.filter((item) => item.name !== server.name);
  return [...existing, merged].sort((a, b) => a.name.localeCompare(b.name));
}

export function shortDiagnosticErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function mergeMcpServerDiagnostic(current: McpServerDiagnostic | undefined, update: McpServerDiagnostic): McpServerDiagnostic {
  const connectionUpdated = update.connectionStatus !== "unknown";
  return {
    name: update.name,
    connectionStatus: connectionUpdated ? update.connectionStatus : (current?.connectionStatus ?? "unknown"),
    authStatus: update.authStatus ?? current?.authStatus ?? null,
    toolCount: update.toolCount ?? current?.toolCount ?? null,
    message: update.message ?? (connectionUpdated ? null : (current?.message ?? null)),
    authenticationIssue: update.authenticationIssue ?? (connectionUpdated ? null : (current?.authenticationIssue ?? null)),
  };
}

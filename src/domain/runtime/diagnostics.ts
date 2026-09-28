import type { ServerInitialization } from "./metadata";
import type { McpServerDiagnostic } from "./tool-inventory";

const DIAGNOSTIC_PROBE_DEFINITIONS = {
  models: { label: "Models" },
  skills: { label: "Skills" },
  permissionProfiles: { label: "Permission profiles" },
  rateLimits: { label: "Rate limits" },
} as const;

export type DiagnosticProbeId = keyof typeof DIAGNOSTIC_PROBE_DEFINITIONS;
export type DiagnosticProbeResult =
  | { readonly status: "unknown"; readonly message: null; readonly summary: null; readonly checkedAt: null }
  | { readonly status: "ok"; readonly message: null; readonly summary: string; readonly checkedAt: number }
  | { readonly status: "failed"; readonly message: string; readonly summary: null; readonly checkedAt: number };

export interface MetadataResourceDiagnostics {
  readonly probes: Readonly<Record<DiagnosticProbeId, DiagnosticProbeResult>>;
}

export interface Diagnostics extends MetadataResourceDiagnostics {
  readonly mcpServers: readonly McpServerDiagnostic[];
}

export function createServerDiagnostics(): Diagnostics {
  return {
    probes: createMetadataResourceDiagnostics().probes,
    mcpServers: [],
  };
}

export function createMetadataResourceDiagnostics(): MetadataResourceDiagnostics {
  return {
    probes: {
      models: createDiagnosticProbeResult(),
      skills: createDiagnosticProbeResult(),
      permissionProfiles: createDiagnosticProbeResult(),
      rateLimits: createDiagnosticProbeResult(),
    },
  };
}

export function serverDiagnostics(metadata: MetadataResourceDiagnostics, mcpServers: readonly McpServerDiagnostic[]): Diagnostics {
  return {
    probes: metadata.probes,
    mcpServers,
  };
}

function createDiagnosticProbeResult(): DiagnosticProbeResult {
  return {
    status: "unknown",
    message: null,
    summary: null,
    checkedAt: null,
  };
}

export function diagnosticProbeOk(summary: string, checkedAt: number): DiagnosticProbeResult {
  return {
    status: "ok",
    message: null,
    summary,
    checkedAt,
  };
}

export function diagnosticProbeError(error: unknown, checkedAt: number): DiagnosticProbeResult {
  return {
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

import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { McpAuthStatus } from "../generated/app-server/v2/McpAuthStatus";
import type { McpServerStartupState } from "../generated/app-server/v2/McpServerStartupState";

export const CAPABILITY_PROBE_METHODS = [
  "model/list",
  "skills/list",
  "hooks/list",
  "account/rateLimits/read",
  "mcpServerStatus/list",
  "collaborationMode/list",
  "modelProvider/capabilities/read",
] as const;

export type CapabilityProbeMethod = (typeof CAPABILITY_PROBE_METHODS)[number];
export type CapabilityProbeStatus = "unknown" | "ok" | "failed" | "unsupported";

export interface CapabilityProbeResult {
  method: CapabilityProbeMethod;
  status: CapabilityProbeStatus;
  message: string | null;
  summary: string | null;
  checkedAt: number | null;
}

export interface McpServerDiagnostic {
  name: string;
  startupStatus: McpServerStartupState | "unknown";
  authStatus: McpAuthStatus | null;
  toolCount: number | null;
  message: string | null;
}

export interface AppServerDiagnostics {
  probes: Record<CapabilityProbeMethod, CapabilityProbeResult>;
  mcpServers: McpServerDiagnostic[];
}

export function createAppServerDiagnostics(): AppServerDiagnostics {
  return {
    probes: Object.fromEntries(CAPABILITY_PROBE_METHODS.map((method) => [method, createCapabilityProbeResult(method)])) as Record<
      CapabilityProbeMethod,
      CapabilityProbeResult
    >,
    mcpServers: [],
  };
}

export function createCapabilityProbeResult(method: CapabilityProbeMethod): CapabilityProbeResult {
  return {
    method,
    status: "unknown",
    message: null,
    summary: null,
    checkedAt: null,
  };
}

export function capabilityProbeOk(
  method: CapabilityProbeMethod,
  summary: string | null = null,
  checkedAt = Date.now(),
): CapabilityProbeResult {
  return {
    method,
    status: "ok",
    message: null,
    summary,
    checkedAt,
  };
}

export function capabilityProbeError(method: CapabilityProbeMethod, error: unknown, checkedAt = Date.now()): CapabilityProbeResult {
  return {
    method,
    status: isUnsupportedRpcError(error) ? "unsupported" : "failed",
    message: shortErrorMessage(error),
    summary: null,
    checkedAt,
  };
}

export function appServerIdentity(initializeResponse: InitializeResponse | null): string {
  return initializeResponse?.userAgent || "(not connected)";
}

export function appServerPlatform(initializeResponse: InitializeResponse | null): string {
  if (!initializeResponse) return "(not connected)";
  const family = initializeResponse.platformFamily || "unknown";
  const os = initializeResponse.platformOs || "unknown";
  return `${os}/${family}`;
}

export function upsertMcpServerDiagnostic(diagnostics: AppServerDiagnostics, server: McpServerDiagnostic): AppServerDiagnostics {
  const current = diagnostics.mcpServers.find((item) => item.name === server.name);
  const merged = mergeMcpServerDiagnostic(current, server);
  const existing = diagnostics.mcpServers.filter((item) => item.name !== server.name);
  return {
    ...diagnostics,
    mcpServers: [...existing, merged].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function shortErrorMessage(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function isUnsupportedRpcError(error: unknown): boolean {
  const maybeCode = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (maybeCode === -32601) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\bmethod not found\b/i.test(message) || /\b(unsupported|unknown)\s+(rpc\s+)?method\b/i.test(message);
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

import { errorMessage } from "../text/error-message";
import type { ServerInitialization } from "./metadata";

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

export function shortDiagnosticErrorMessage(error: unknown, maxLength = 160): string {
  const message = errorMessage(error);
  const compact = message.replace(/\s+/g, " ").trim() || "Codex app-server request failed.";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

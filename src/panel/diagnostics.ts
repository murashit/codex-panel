import { CAPABILITY_PROBE_METHODS, appServerIdentity, appServerPlatform } from "../app-server/compatibility";
import { CLIENT_VERSION } from "../constants";
import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { AppServerDiagnostics, CapabilityProbeResult, McpServerDiagnostic } from "../app-server/compatibility";

export interface DiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export type DiagnosticAlertLevel = "normal" | "warning" | "error";

export interface ConnectionDiagnosticsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: InitializeResponse | null;
  activeThreadCliVersion: string | null;
  diagnostics: AppServerDiagnostics;
}

export function connectionDiagnosticRows(input: ConnectionDiagnosticsInput): DiagnosticRow[] {
  return [
    { label: "connection", value: input.connected ? "connected" : "offline" },
    { label: "configured command", value: input.configuredCommand },
    { label: "running app-server", value: appServerIdentity(input.initializeResponse) },
    { label: "panel client", value: CLIENT_VERSION },
    { label: "platform", value: appServerPlatform(input.initializeResponse) },
    { label: "codexHome", value: input.initializeResponse?.codexHome ?? "(not connected)" },
    { label: "active thread CLI", value: input.activeThreadCliVersion ?? "(none)" },
    ...CAPABILITY_PROBE_METHODS.map((method) => capabilityDiagnosticRow(input.diagnostics.probes[method])),
    ...mcpServerDiagnosticRows(input.diagnostics.mcpServers),
  ];
}

export function connectionDiagnosticLines(rows: DiagnosticRow[]): string[] {
  return ["Connection diagnostics", ...rows.map((row) => `${row.label}: ${row.value}`)];
}

export function diagnosticAlertLevel(diagnostics: AppServerDiagnostics): DiagnosticAlertLevel {
  let hasWarning = false;
  for (const probe of Object.values(diagnostics.probes)) {
    if (probe.status === "failed") return "error";
  }
  for (const server of diagnostics.mcpServers) {
    if (server.startupStatus === "failed") return "error";
    if (server.authStatus === "notLoggedIn") hasWarning = true;
  }
  return hasWarning ? "warning" : "normal";
}

function capabilityDiagnosticRow(probe: CapabilityProbeResult): DiagnosticRow {
  const detail = probe.message ? ` - ${probe.message}` : probe.summary ? ` (${probe.summary})` : "";
  return {
    label: `capability ${probe.method}`,
    value: `${probe.status}${detail}`,
    level: capabilityLevel(probe.status),
  };
}

function mcpServerDiagnosticRows(servers: McpServerDiagnostic[]): DiagnosticRow[] {
  return servers.filter(isMcpServerIssue).map((server) => ({
    label: `mcp ${server.name}`,
    value: mcpServerDiagnosticValue(server),
    level: server.startupStatus === "failed" ? "error" : "warning",
  }));
}

function capabilityLevel(status: CapabilityProbeResult["status"]): DiagnosticRow["level"] {
  if (status === "failed") return "error";
  if (status === "unsupported" || status === "unknown") return "warning";
  return "normal";
}

function isMcpServerIssue(server: McpServerDiagnostic): boolean {
  return server.startupStatus === "failed" || server.authStatus === "notLoggedIn";
}

function mcpServerDiagnosticValue(server: McpServerDiagnostic): string {
  const parts: string[] = [server.startupStatus];
  if (server.authStatus) parts.push(`auth ${server.authStatus}`);
  if (server.message) parts.push(server.message);
  return parts.join(" - ");
}

import { CAPABILITY_PROBE_METHODS, appServerIdentity, appServerPlatform } from "../../app-server/compatibility";
import { CLIENT_VERSION } from "../../constants";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { AppServerDiagnostics, CapabilityProbeResult, McpServerDiagnostic } from "../../app-server/compatibility";

export interface DiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface DiagnosticSection {
  title: string;
  rows: DiagnosticRow[];
}

export interface ConnectionDiagnosticsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: InitializeResponse | null;
  activeThreadCreationCliVersion: string | null;
  diagnostics: AppServerDiagnostics;
}

export function connectionDiagnosticSections(input: ConnectionDiagnosticsInput): DiagnosticSection[] {
  const mcpRows = mcpServerDiagnosticRows(input.diagnostics.mcpServers);
  return [
    {
      title: "Process",
      rows: [
        { label: "connection", value: input.connected ? "connected" : "offline" },
        { label: "configured command", value: input.configuredCommand },
        { label: "Codex App Server", value: appServerIdentity(input.initializeResponse) },
        { label: "panel client", value: CLIENT_VERSION },
        { label: "platform", value: appServerPlatform(input.initializeResponse) },
        { label: "Codex home", value: input.initializeResponse?.codexHome ?? "(not connected)" },
        { label: "thread created by CLI", value: input.activeThreadCreationCliVersion ?? "(none)" },
      ],
    },
    {
      title: "Capabilities",
      rows: CAPABILITY_PROBE_METHODS.map((method) => capabilityDiagnosticRow(input.diagnostics.probes[method])),
    },
    {
      title: "MCP issues",
      rows: mcpRows.length > 0 ? mcpRows : [{ label: "issues", value: "(none)" }],
    },
  ];
}

export function hasDiagnosticIssue(diagnostics: AppServerDiagnostics): boolean {
  for (const probe of Object.values(diagnostics.probes)) {
    if (probe.status === "failed") return true;
  }
  for (const server of diagnostics.mcpServers) {
    if (server.startupStatus === "failed") return true;
    if (server.authStatus === "notLoggedIn") return true;
  }
  return false;
}

function capabilityDiagnosticRow(probe: CapabilityProbeResult): DiagnosticRow {
  const detail = probe.message ? ` - ${probe.message}` : probe.summary ? ` (${probe.summary})` : "";
  return {
    label: probe.method,
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

function capabilityLevel(status: CapabilityProbeResult["status"]): NonNullable<DiagnosticRow["level"]> {
  if (status === "failed") return "error";
  if (status === "unknown") return "warning";
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

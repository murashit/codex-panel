import { DIAGNOSTIC_PROBE_METHODS, serverIdentity, serverPlatform } from "../../../../domain/server/diagnostics";
import { CLIENT_VERSION } from "../../../../constants";
import type {
  Diagnostics,
  InitializeDiagnostics,
  DiagnosticProbeResult,
  McpServerDiagnostic,
  McpServerStatusSummary,
} from "../../../../domain/server/diagnostics";

interface DiagnosticRow {
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
  initializeResponse: InitializeDiagnostics | null;
  diagnostics: Diagnostics;
}

export function connectionDiagnosticSections(input: ConnectionDiagnosticsInput): DiagnosticSection[] {
  const mcpRows = mcpServerDiagnosticRows(input.diagnostics.mcpServers);
  return [
    {
      title: "Process",
      rows: [
        { label: "connection", value: input.connected ? "connected" : "offline" },
        { label: "configured command", value: input.configuredCommand },
        { label: "Codex App Server", value: serverIdentity(input.initializeResponse) },
        { label: "panel client", value: CLIENT_VERSION },
        { label: "platform", value: serverPlatform(input.initializeResponse) },
        { label: "Codex home", value: input.initializeResponse?.codexHome ?? "(not connected)" },
      ],
    },
    {
      title: "App Server Checks",
      rows: DIAGNOSTIC_PROBE_METHODS.map((method) => diagnosticProbeRow(input.diagnostics.probes[method])),
    },
    {
      title: "MCP issues",
      rows: mcpRows.length > 0 ? mcpRows : [{ label: "issues", value: "(none)" }],
    },
  ];
}

export function hasDiagnosticIssue(diagnostics: Diagnostics): boolean {
  for (const probe of Object.values(diagnostics.probes)) {
    if (probe.status === "failed") return true;
  }
  for (const server of diagnostics.mcpServers) {
    if (server.startupStatus === "failed") return true;
    if (server.authStatus === "notLoggedIn") return true;
  }
  return false;
}

function diagnosticProbeRow(probe: DiagnosticProbeResult): DiagnosticRow {
  const detail = probe.message ? ` - ${probe.message}` : probe.summary ? ` (${probe.summary})` : "";
  return {
    label: probe.method,
    value: `${probe.status}${detail}`,
    level: diagnosticProbeLevel(probe.status),
  };
}

function mcpServerDiagnosticRows(servers: McpServerDiagnostic[]): DiagnosticRow[] {
  return servers.filter(isMcpServerIssue).map((server) => ({
    label: `mcp ${server.name}`,
    value: mcpServerDiagnosticValue(server),
    level: server.startupStatus === "failed" ? "error" : "warning",
  }));
}

function diagnosticProbeLevel(status: DiagnosticProbeResult["status"]): NonNullable<DiagnosticRow["level"]> {
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

export function mcpStatusLines(servers: McpServerStatusSummary[], diagnostics: McpServerDiagnostic[] = []): string[] {
  if (servers.length === 0 && diagnostics.length === 0) {
    return ["MCP servers", "Codex App Server reports no MCP servers."];
  }

  const statusByName = new Map(servers.map((server) => [server.name, server]));
  const diagnosticByName = new Map(diagnostics.map((diagnostic) => [diagnostic.name, diagnostic]));
  const names = new Set([...statusByName.keys(), ...diagnosticByName.keys()]);
  const rows = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const server = statusByName.get(name);
      const diagnostic = diagnosticByName.get(name);
      return server ? mcpServerStatusLine(server, diagnostic) : mcpDiagnosticOnlyLine(name, diagnostic);
    });

  return ["MCP servers", ...rows];
}

function mcpServerStatusLine(server: McpServerStatusSummary, diagnostic: McpServerDiagnostic | undefined): string {
  const startup = diagnostic?.startupStatus && diagnostic.startupStatus !== "unknown" ? diagnostic.startupStatus : "available";
  const tools = server.toolCount;
  const resources = server.resourceCount;
  const templates = server.resourceTemplateCount;
  const parts = [startup, `auth ${server.authStatus}`, countLabel(tools, "tool"), countLabel(resources, "resource")];
  if (templates > 0) parts.push(countLabel(templates, "resource template"));
  if (diagnostic?.message) parts.push(diagnostic.message);
  return `${server.name}: ${parts.join(", ")}`;
}

function mcpDiagnosticOnlyLine(name: string, diagnostic: McpServerDiagnostic | undefined): string {
  const startup = diagnostic?.startupStatus ?? "unknown";
  const auth = diagnostic?.authStatus ? `auth ${diagnostic.authStatus}` : "auth unknown";
  const tools =
    diagnostic?.toolCount === null || diagnostic?.toolCount === undefined ? "tools unknown" : countLabel(diagnostic.toolCount, "tool");
  const parts = [startup, auth, tools];
  if (diagnostic?.message) parts.push(diagnostic.message);
  return `${name}: ${parts.join(", ")}`;
}

function countLabel(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
}

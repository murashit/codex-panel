import type { McpServerDiagnostic, McpServerStatusSummary } from "../../app-server/diagnostics";

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

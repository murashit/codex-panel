import type { DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";

interface ServerDiagnosticsReadRequest {
  threadId: string | null;
  initialDiagnostics: Diagnostics;
}

export interface ServerDiagnosticsSnapshot {
  toolInventory: {
    inventory: ToolInventorySnapshot;
    probes: readonly DiagnosticProbeResult[];
    mcpServerStatuses: readonly McpServerStatusSummary[] | null;
  };
}

export interface ServerDiagnosticsPort {
  readServerDiagnostics(request: ServerDiagnosticsReadRequest): Promise<ServerDiagnosticsSnapshot | null>;
}

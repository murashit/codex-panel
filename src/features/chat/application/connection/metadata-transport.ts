import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";

interface ServerDiagnosticsReadRequest {
  threadId: string | null;
  initialDiagnostics: Diagnostics;
  cachedSkills?: readonly SkillMetadata[];
  cachedSkillsProbe?: DiagnosticProbeResult;
  forceResourceProbes: boolean;
  appServerMetadataSnapshot: boolean;
}

export interface ServerDiagnosticsSnapshot {
  resourceProbes: readonly DiagnosticProbeResult[];
  toolInventory: {
    inventory: ToolInventorySnapshot;
    probes: readonly DiagnosticProbeResult[];
    mcpServerStatuses: readonly McpServerStatusSummary[] | null;
  };
}

export interface ServerDiagnosticsTransport {
  readServerDiagnostics(request: ServerDiagnosticsReadRequest): Promise<ServerDiagnosticsSnapshot | null>;
}

import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import type { DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";

interface MetadataProbeResult<T, K extends keyof Diagnostics["probes"]> {
  value: T;
  probe: Diagnostics["probes"][K];
}

type SkillMetadataProbeResult = MetadataProbeResult<readonly SkillMetadata[], "skills">;
export type RateLimitMetadataProbeResult = MetadataProbeResult<RateLimitSnapshot | null, "rateLimits">;

export interface MetadataResourceTransport {
  readSkillMetadata(forceReload?: boolean): Promise<SkillMetadataProbeResult | null>;
  readRateLimitMetadata(): Promise<RateLimitMetadataProbeResult | null>;
}

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

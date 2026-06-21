import type { AppServerClient } from "../../../../app-server/connection/client";
import {
  cloneServerDiagnostics,
  diagnosticsWithToolInventory,
  diagnosticsWithProbe,
  diagnosticProbeError,
  diagnosticProbeOk,
  upsertMcpServerStatusDiagnostics,
  upsertMcpServerDiagnostic,
  type Diagnostics,
  type DiagnosticProbeMethod,
  type McpServerStartupStatus,
} from "../../../../domain/server/diagnostics";
import { readToolInventory } from "../../../../app-server/tool-inventory";
import { readRateLimitMetadataProbe } from "../../../../app-server/query/metadata-probes";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { captureChatServerActionClientScope, type ChatServerActionHost } from "./host";

interface RefreshServerDiagnosticsOptions {
  appServerMetadataSnapshot?: boolean;
  forceResourceProbes?: boolean;
}

interface DiagnosticProbeSnapshot {
  probe: Diagnostics["probes"][DiagnosticProbeMethod];
}

export interface ChatServerDiagnosticsActionsHost extends ChatServerActionHost {
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
}

export interface ChatServerDiagnosticsActions {
  refreshServerDiagnostics: (options?: RefreshServerDiagnosticsOptions) => Promise<void>;
  recordMcpStartupStatus: (name: string, startupStatus: McpServerStartupStatus, message: string | null) => void;
}

export function createChatServerDiagnosticsActions(host: ChatServerDiagnosticsActionsHost): ChatServerDiagnosticsActions {
  return {
    refreshServerDiagnostics: async (options) => {
      await refreshServerDiagnostics(host, options);
    },
    recordMcpStartupStatus: (name, startupStatus, message) => {
      recordMcpStartupStatus(host, name, startupStatus, message);
    },
  };
}

async function refreshServerDiagnostics(
  host: ChatServerDiagnosticsActionsHost,
  options: RefreshServerDiagnosticsOptions = {},
): Promise<boolean> {
  const scope = captureChatServerActionClientScope(host);
  if (!scope.client) return false;
  const client = scope.client;

  const initialDiagnostics = currentMetadataDiagnostics(host);
  const state = host.stateStore.getState();
  const activeThreadId = state.activeThread.id;
  const metadataSnapshot = host.appServerMetadataSnapshot();
  const cachedSkills =
    options.forceResourceProbes === true ? undefined : (metadataSnapshot?.availableSkills ?? state.connection.availableSkills);
  const cachedSkillsProbe =
    options.forceResourceProbes === true
      ? undefined
      : (metadataSnapshot?.serverDiagnostics.probes["skills/list"] ?? state.connection.serverDiagnostics.probes["skills/list"]);
  const toolInventory = readToolInventory(client, host.vaultPath, {
    threadId: activeThreadId,
    mcpDiagnostics: initialDiagnostics.mcpServers,
    ...(cachedSkills !== undefined ? { cachedSkills } : {}),
    ...(cachedSkillsProbe !== undefined ? { cachedSkillsProbe } : {}),
  });
  const probes: Promise<DiagnosticProbeSnapshot>[] = [];
  if (options.forceResourceProbes === true && options.appServerMetadataSnapshot !== true) {
    probes.push(
      probeDiagnostic(
        "model/list",
        () => client.listModels(false),
        (response) => `${String(response.data.length)} models`,
      ),
      readRateLimitDiagnosticProbe(client),
    );
  }

  const [results, toolInventoryResult] = await Promise.all([Promise.all(probes), toolInventory]);
  if (scope.isStale()) return false;

  let diagnostics = currentMetadataDiagnostics(host);
  for (const result of results) {
    diagnostics = diagnosticsWithProbe(diagnostics, result.probe);
  }
  for (const probe of toolInventoryResult.probes) {
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  if (toolInventoryResult.mcpServerStatuses) {
    diagnostics = upsertMcpServerStatusDiagnostics(diagnostics, toolInventoryResult.mcpServerStatuses);
  }
  diagnostics = diagnosticsWithToolInventory(diagnostics, toolInventoryResult.inventory);
  host.updateAppServerMetadata((metadata) => (metadata ? { ...metadata, serverDiagnostics: diagnostics } : null));
  host.stateStore.dispatch({ type: "connection/metadata-applied", serverDiagnostics: diagnostics });
  return true;
}

async function readRateLimitDiagnosticProbe(client: AppServerClient): Promise<DiagnosticProbeSnapshot> {
  const result = await readRateLimitMetadataProbe(client);
  return { probe: result.probe };
}

function recordMcpStartupStatus(
  host: ChatServerDiagnosticsActionsHost,
  name: string,
  startupStatus: McpServerStartupStatus,
  message: string | null,
): void {
  const diagnostics = upsertMcpServerDiagnostic(currentMetadataDiagnostics(host), {
    name,
    startupStatus,
    authStatus: null,
    toolCount: null,
    message,
  });
  host.updateAppServerMetadata((metadata) => (metadata ? { ...metadata, serverDiagnostics: diagnostics } : null));
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    serverDiagnostics: diagnostics,
  });
}

function currentMetadataDiagnostics(host: ChatServerDiagnosticsActionsHost): SharedServerMetadata["serverDiagnostics"] {
  return (
    host.appServerMetadataSnapshot()?.serverDiagnostics ?? cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics)
  );
}

async function probeDiagnostic<T>(
  method: DiagnosticProbeMethod,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
): Promise<DiagnosticProbeSnapshot> {
  try {
    const response = await request();
    return {
      probe: diagnosticProbeOk(method, summarize(response), Date.now()),
    };
  } catch (error) {
    return { probe: diagnosticProbeError(method, error, Date.now()) };
  }
}

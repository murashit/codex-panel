import type { AppServerClient } from "../../../../app-server/connection/client";
import { readRateLimitMetadataProbe } from "../../../../app-server/query/metadata-probes";
import { readToolInventory } from "../../../../app-server/services/tool-inventory";
import {
  cloneServerDiagnostics,
  type DiagnosticProbeMethod,
  type Diagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  upsertMcpServerStatusDiagnostics,
} from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { type ChatServerActionsHost, captureChatServerClientScope } from "./host";

interface RefreshServerDiagnosticsOptions {
  appServerMetadataSnapshot?: boolean;
  forceResourceProbes?: boolean;
}

interface DiagnosticProbeSnapshot {
  probe: Diagnostics["probes"][DiagnosticProbeMethod];
}

export interface ChatServerDiagnosticsActionsHost extends ChatServerActionsHost {
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
}

export interface ChatServerDiagnosticsActions {
  refreshServerDiagnostics: (options?: RefreshServerDiagnosticsOptions) => Promise<void>;
}

export function createChatServerDiagnosticsActions(host: ChatServerDiagnosticsActionsHost): ChatServerDiagnosticsActions {
  return {
    refreshServerDiagnostics: async (options) => {
      await refreshServerDiagnostics(host, options);
    },
  };
}

async function refreshServerDiagnostics(
  host: ChatServerDiagnosticsActionsHost,
  options: RefreshServerDiagnosticsOptions = {},
): Promise<boolean> {
  const scope = captureChatServerClientScope(host);
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

import {
  cloneServerDiagnostics,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  upsertMcpServerStatusDiagnostics,
} from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { ChatStateStore } from "../state/store";
import type { ServerDiagnosticsTransport } from "./metadata-transport";

interface RefreshServerDiagnosticsOptions {
  appServerMetadataSnapshot?: boolean;
  forceResourceProbes?: boolean;
}

export interface ServerDiagnosticsActionsHost {
  stateStore: ChatStateStore;
  diagnosticsTransport: ServerDiagnosticsTransport;
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
}

export interface ServerDiagnosticsActions {
  refreshServerDiagnostics: (options?: RefreshServerDiagnosticsOptions) => Promise<void>;
}

export function createServerDiagnosticsActions(host: ServerDiagnosticsActionsHost): ServerDiagnosticsActions {
  return {
    refreshServerDiagnostics: async (options) => {
      await refreshServerDiagnostics(host, options);
    },
  };
}

async function refreshServerDiagnostics(
  host: ServerDiagnosticsActionsHost,
  options: RefreshServerDiagnosticsOptions = {},
): Promise<boolean> {
  const initialDiagnostics = currentMetadataDiagnostics(host);
  const state = host.stateStore.getState();
  const activeThreadId = state.activeThread.id;
  const metadataSnapshot = host.appServerMetadataSnapshot();
  const cachedSkills =
    options.forceResourceProbes === true ? undefined : (metadataSnapshot?.availableSkills ?? state.connection.availableSkills);
  const cachedSkillsProbe =
    options.forceResourceProbes === true
      ? undefined
      : (metadataSnapshot?.serverDiagnostics.probes.skills ?? state.connection.serverDiagnostics.probes.skills);
  const request = {
    threadId: activeThreadId,
    initialDiagnostics,
    forceResourceProbes: options.forceResourceProbes === true,
    appServerMetadataSnapshot: options.appServerMetadataSnapshot === true,
    ...(cachedSkills !== undefined ? { cachedSkills } : {}),
    ...(cachedSkillsProbe !== undefined ? { cachedSkillsProbe } : {}),
  };
  const snapshot = await host.diagnosticsTransport.readServerDiagnostics(request);
  if (!snapshot) return false;

  let diagnostics = currentMetadataDiagnostics(host);
  for (const probe of snapshot.resourceProbes) {
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  for (const probe of snapshot.toolInventory.probes) {
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  if (snapshot.toolInventory.mcpServerStatuses) {
    diagnostics = upsertMcpServerStatusDiagnostics(diagnostics, snapshot.toolInventory.mcpServerStatuses);
  }
  diagnostics = diagnosticsWithToolInventory(diagnostics, snapshot.toolInventory.inventory);
  host.updateAppServerMetadata((metadata) => (metadata ? { ...metadata, serverDiagnostics: diagnostics } : null));
  host.stateStore.dispatch({ type: "connection/metadata-applied", serverDiagnostics: diagnostics });
  return true;
}

function currentMetadataDiagnostics(host: ServerDiagnosticsActionsHost): SharedServerMetadata["serverDiagnostics"] {
  return (
    host.appServerMetadataSnapshot()?.serverDiagnostics ?? cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics)
  );
}

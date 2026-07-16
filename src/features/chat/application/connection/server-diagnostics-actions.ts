import {
  cloneServerDiagnostics,
  diagnosticsWithMetadataResourceProbes,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  replaceMcpServerStatusDiagnostics,
} from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { activeThreadId } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ServerDiagnosticsTransport } from "./metadata-transport";

interface RefreshServerDiagnosticsOptions {
  appServerMetadataSnapshot?: boolean;
  forceResourceProbes?: boolean;
}

export interface ServerDiagnosticsActionsHost {
  stateStore: ChatStateStore;
  diagnosticsTransport: ServerDiagnosticsTransport;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
}

export interface ServerDiagnosticsActions {
  refreshServerDiagnostics: (options?: RefreshServerDiagnosticsOptions) => Promise<void>;
  invalidate(): void;
}

export function createServerDiagnosticsActions(host: ServerDiagnosticsActionsHost): ServerDiagnosticsActions {
  let generation = 0;
  return {
    refreshServerDiagnostics: async (options) => {
      const currentGeneration = ++generation;
      await refreshServerDiagnostics(host, options, () => currentGeneration === generation);
    },
    invalidate: () => {
      generation += 1;
    },
  };
}

async function refreshServerDiagnostics(
  host: ServerDiagnosticsActionsHost,
  options: RefreshServerDiagnosticsOptions = {},
  isCurrent: () => boolean,
): Promise<boolean> {
  const initialDiagnostics = currentPanelDiagnostics(host);
  const state = host.stateStore.getState();
  const threadId = activeThreadId(state);
  const metadataSnapshot = host.appServerMetadataSnapshot();
  const cachedSkills =
    options.forceResourceProbes === true ? undefined : (metadataSnapshot?.availableSkills ?? state.connection.availableSkills);
  const cachedSkillsProbe =
    options.forceResourceProbes === true
      ? undefined
      : (metadataSnapshot?.serverDiagnostics.probes.skills ?? state.connection.serverDiagnostics.probes.skills);
  const request = {
    threadId,
    initialDiagnostics,
    forceResourceProbes: options.forceResourceProbes === true,
    appServerMetadataSnapshot: options.appServerMetadataSnapshot === true,
    ...(cachedSkills !== undefined ? { cachedSkills } : {}),
    ...(cachedSkillsProbe !== undefined ? { cachedSkillsProbe } : {}),
  };
  const snapshot = await host.diagnosticsTransport.readServerDiagnostics(request);
  if (!snapshot || !isCurrent() || activeThreadId(host.stateStore.getState()) !== threadId) return false;

  let diagnostics = currentPanelDiagnostics(host);
  for (const probe of snapshot.resourceProbes) {
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  for (const probe of snapshot.toolInventory.probes) {
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  if (snapshot.toolInventory.mcpServerStatuses) {
    diagnostics = replaceMcpServerStatusDiagnostics(diagnostics, snapshot.toolInventory.mcpServerStatuses);
  }
  diagnostics = diagnosticsWithToolInventory(diagnostics, snapshot.toolInventory.inventory);
  host.stateStore.dispatch({ type: "connection/metadata-applied", serverDiagnostics: diagnostics });
  return true;
}

function currentPanelDiagnostics(host: ServerDiagnosticsActionsHost): SharedServerMetadata["serverDiagnostics"] {
  const current = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  const metadata = host.appServerMetadataSnapshot();
  return metadata ? diagnosticsWithMetadataResourceProbes(current, metadata.serverDiagnostics) : current;
}

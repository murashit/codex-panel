import type { Diagnostics } from "../../../../domain/server/diagnostics";
import {
  cloneServerDiagnostics,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  replaceMcpServerStatusDiagnostics,
} from "../../../../domain/server/diagnostics";
import { activeThreadId } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ServerDiagnosticsPort } from "./server-diagnostics-port";

export interface ServerDiagnosticsCoordinatorHost {
  stateStore: ChatStateStore;
  diagnosticsPort: ServerDiagnosticsPort;
}

export interface ServerDiagnosticsCoordinator {
  refreshServerDiagnostics: () => Promise<void>;
  invalidate(): void;
}

export function createServerDiagnosticsCoordinator(host: ServerDiagnosticsCoordinatorHost): ServerDiagnosticsCoordinator {
  let generation = 0;
  return {
    refreshServerDiagnostics: async () => {
      const currentGeneration = ++generation;
      await refreshServerDiagnostics(host, () => currentGeneration === generation);
    },
    invalidate: () => {
      generation += 1;
    },
  };
}

async function refreshServerDiagnostics(host: ServerDiagnosticsCoordinatorHost, isCurrent: () => boolean): Promise<boolean> {
  const initialDiagnostics = currentPanelDiagnostics(host);
  const state = host.stateStore.getState();
  const threadId = activeThreadId(state);
  const request = {
    threadId,
    initialDiagnostics,
  };
  const snapshot = await host.diagnosticsPort.readServerDiagnostics(request);
  if (!snapshot || !isCurrent() || activeThreadId(host.stateStore.getState()) !== threadId) return false;

  let diagnostics = currentPanelDiagnostics(host);
  for (const probe of snapshot.toolInventory.probes) {
    if (probe.id !== "plugins" && probe.id !== "mcpServers") continue;
    diagnostics = diagnosticsWithProbe(diagnostics, probe);
  }
  if (snapshot.toolInventory.mcpServerStatuses) {
    diagnostics = replaceMcpServerStatusDiagnostics(diagnostics, snapshot.toolInventory.mcpServerStatuses);
  }
  diagnostics = diagnosticsWithToolInventory(diagnostics, snapshot.toolInventory.inventory);
  host.stateStore.dispatch({ type: "connection/diagnostics-applied", serverDiagnostics: diagnostics });
  return true;
}

function currentPanelDiagnostics(host: ServerDiagnosticsCoordinatorHost): Diagnostics {
  return cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
}

import { cloneServerDiagnostics, upsertMcpServerDiagnostic } from "../../../../domain/server/diagnostics";
import type { McpServerStartupStatus } from "../../../../domain/server/mcp-status";
import type { ChatStateStore } from "../state/store";

export type AppServerResourceFact =
  | { type: "skills-changed" }
  | { type: "rate-limits-updated" }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ServerMetadataEffectsHost {
  stateStore: ChatStateStore;
  refreshAppServerMetadata: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  isStaleRuntimeError: (error: unknown) => boolean;
}

export interface ServerMetadataEffects {
  refreshAppServerMetadata: () => Promise<void>;
  handleAppServerResourceFact: (fact: AppServerResourceFact) => Promise<void>;
}

export function createServerMetadataEffects(host: ServerMetadataEffectsHost): ServerMetadataEffects {
  return {
    refreshAppServerMetadata: () => refreshAppServerMetadata(host),
    handleAppServerResourceFact: async (fact) => {
      if (fact.type === "skills-changed") {
        await refreshMetadataResource(host, host.refreshSkills);
        return;
      }
      if (fact.type === "rate-limits-updated") {
        await refreshMetadataResource(host, host.refreshRateLimits);
        return;
      }
      applyAppServerResourceFact(host, fact);
    },
  };
}

function applyAppServerResourceFact(host: ServerMetadataEffectsHost, fact: AppServerResourceFact): void {
  switch (fact.type) {
    case "skills-changed":
    case "rate-limits-updated":
      return;
    case "mcp-startup-status-updated":
      if (fact.name.length > 0) {
        applyMcpStartupStatusEvent(host, fact.name, fact.status, fact.message);
      }
      return;
  }
}

async function refreshAppServerMetadata(host: ServerMetadataEffectsHost): Promise<void> {
  try {
    await host.refreshAppServerMetadata();
  } catch (error) {
    if (host.isStaleRuntimeError(error)) return;
    throw error;
  }
}

async function refreshMetadataResource(host: ServerMetadataEffectsHost, refresh: () => Promise<void>): Promise<void> {
  try {
    await refresh();
  } catch (error) {
    if (!host.isStaleRuntimeError(error)) throw error;
  }
}

function applyMcpStartupStatusEvent(
  host: ServerMetadataEffectsHost,
  name: string,
  startupStatus: McpServerStartupStatus,
  message: string | null,
): void {
  const diagnostics = upsertMcpServerDiagnostic(cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics), {
    name,
    startupStatus,
    authStatus: null,
    toolCount: null,
    message,
  });
  host.stateStore.dispatch({
    type: "connection/diagnostics-applied",
    serverDiagnostics: diagnostics,
  });
}

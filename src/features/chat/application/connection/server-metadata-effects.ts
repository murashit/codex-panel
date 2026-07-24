import {
  cloneServerDiagnostics,
  diagnosticsWithMetadataResourceProbes,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
} from "../../../../domain/server/diagnostics";
import type { McpServerStartupStatus } from "../../../../domain/server/mcp-status";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../../../domain/server/metadata";
import type { ChatStateStore } from "../state/store";

export type AppServerResourceFact =
  | { type: "skills-changed" }
  | { type: "rate-limits-updated" }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ServerMetadataEffectsHost {
  stateStore: ChatStateStore;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  isStaleRuntimeError: (error: unknown) => boolean;
}

export interface ServerMetadataEffects {
  applyAppServerMetadataResource: (resource: SharedServerMetadataResource) => void;
  refreshAppServerMetadata: () => Promise<void>;
  handleAppServerResourceFact: (fact: AppServerResourceFact) => Promise<void>;
}

export function createServerMetadataEffects(host: ServerMetadataEffectsHost): ServerMetadataEffects {
  return {
    applyAppServerMetadataResource: (resource) => {
      applyAppServerMetadataResource(host, resource);
    },
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

function applyAppServerMetadataResource(host: ServerMetadataEffectsHost, resource: SharedServerMetadataResource): void {
  if (resource.id === "runtimeConfig") {
    if (resource.value) host.stateStore.dispatch({ type: "connection/metadata-applied", runtimeConfig: resource.value });
    return;
  }
  const serverDiagnostics = diagnosticsWithProbe(
    cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics),
    resource.probe,
  );
  switch (resource.id) {
    case "models":
      host.stateStore.dispatch({
        type: "connection/metadata-applied",
        ...(resource.value ? { availableModels: resource.value } : {}),
        serverDiagnostics,
      });
      return;
    case "skills":
      host.stateStore.dispatch({
        type: "connection/metadata-applied",
        ...(resource.value ? { availableSkills: resource.value } : {}),
        serverDiagnostics,
      });
      return;
    case "permissionProfiles":
      host.stateStore.dispatch({
        type: "connection/metadata-applied",
        ...(resource.value ? { availablePermissionProfiles: resource.value } : {}),
        serverDiagnostics,
      });
      return;
    case "rateLimits":
      host.stateStore.dispatch({
        type: "connection/metadata-applied",
        ...(resource.value !== undefined ? { rateLimit: resource.value } : {}),
        serverDiagnostics,
      });
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
  const diagnostics = upsertMcpServerDiagnostic(currentMetadataDiagnostics(host), {
    name,
    startupStatus,
    authStatus: null,
    toolCount: null,
    message,
  });
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    serverDiagnostics: diagnostics,
  });
}

function currentMetadataDiagnostics(host: ServerMetadataEffectsHost): SharedServerMetadata["serverDiagnostics"] {
  const current = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  const metadata = host.appServerMetadataSnapshot();
  return metadata ? diagnosticsWithMetadataResourceProbes(current, metadata.serverDiagnostics) : current;
}

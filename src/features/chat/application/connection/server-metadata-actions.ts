import {
  cloneServerDiagnostics,
  diagnosticsWithMetadataResourceProbes,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
} from "../../../../domain/server/diagnostics";
import type { McpServerStartupStatus } from "../../../../domain/server/mcp-status";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../../../domain/server/metadata";
import type { ChatStateStore } from "../state/store";

export type AppServerResourceEvent =
  | { type: "skills-changed" }
  | { type: "rate-limits-updated" }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ServerMetadataActionsHost {
  stateStore: ChatStateStore;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  isStaleResourceContextError: (error: unknown) => boolean;
}

export interface ServerMetadataActions {
  applyAppServerMetadataResource: (resource: SharedServerMetadataResource) => void;
  refreshAppServerMetadata: () => Promise<void>;
  applyAppServerResourceEvent: (event: AppServerResourceEvent) => Promise<void>;
}

export function createServerMetadataActions(host: ServerMetadataActionsHost): ServerMetadataActions {
  return {
    applyAppServerMetadataResource: (resource) => {
      applyAppServerMetadataResource(host, resource);
    },
    refreshAppServerMetadata: () => refreshAppServerMetadata(host),
    applyAppServerResourceEvent: async (event) => {
      if (event.type === "skills-changed") {
        await refreshMetadataResource(host, host.refreshSkills);
        return;
      }
      if (event.type === "rate-limits-updated") {
        await refreshMetadataResource(host, host.refreshRateLimits);
        return;
      }
      await applyAppServerResourceEvent(host, event);
    },
  };
}

async function applyAppServerResourceEvent(host: ServerMetadataActionsHost, event: AppServerResourceEvent): Promise<void> {
  switch (event.type) {
    case "skills-changed":
    case "rate-limits-updated":
      return;
    case "mcp-startup-status-updated":
      if (event.name.length > 0) {
        applyMcpStartupStatusEvent(host, event.name, event.status, event.message);
      }
      return;
  }
}

function applyAppServerMetadataResource(host: ServerMetadataActionsHost, resource: SharedServerMetadataResource): void {
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

async function refreshAppServerMetadata(host: ServerMetadataActionsHost): Promise<void> {
  try {
    await host.refreshAppServerMetadata();
  } catch (error) {
    if (host.isStaleResourceContextError(error)) return;
    throw error;
  }
}

async function refreshMetadataResource(host: ServerMetadataActionsHost, refresh: () => Promise<void>): Promise<void> {
  try {
    await refresh();
  } catch (error) {
    if (!host.isStaleResourceContextError(error)) throw error;
  }
}

function applyMcpStartupStatusEvent(
  host: ServerMetadataActionsHost,
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

function currentMetadataDiagnostics(host: ServerMetadataActionsHost): SharedServerMetadata["serverDiagnostics"] {
  const current = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  const metadata = host.appServerMetadataSnapshot();
  return metadata ? diagnosticsWithMetadataResourceProbes(current, metadata.serverDiagnostics) : current;
}

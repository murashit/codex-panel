import {
  cloneServerDiagnostics,
  diagnosticsWithMetadataResourceProbes,
  upsertMcpServerDiagnostic,
} from "../../../../domain/server/diagnostics";
import type { McpServerStartupStatus } from "../../../../domain/server/mcp-status";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { ChatStateStore } from "../state/store";

export type AppServerResourceEvent =
  | { type: "skills-changed" }
  | { type: "rate-limits-updated" }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ServerMetadataActionsHost {
  stateStore: ChatStateStore;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  refreshSkills: () => Promise<SharedServerMetadata | null>;
  refreshRateLimits: () => Promise<SharedServerMetadata | null>;
  isStaleResourceContextError: (error: unknown) => boolean;
}

export interface ServerMetadataActions {
  applyAppServerMetadata: (metadata: SharedServerMetadata) => void;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  applyAppServerResourceEvent: (event: AppServerResourceEvent) => Promise<void>;
}

export function createServerMetadataActions(host: ServerMetadataActionsHost): ServerMetadataActions {
  return {
    applyAppServerMetadata: (metadata) => {
      applyAppServerMetadata(host, metadata);
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
      applyCurrentAppServerMetadataSnapshot(host);
      return;
  }
}

function applyAppServerMetadata(host: ServerMetadataActionsHost, metadata: SharedServerMetadata): void {
  const serverDiagnostics = diagnosticsWithMetadataResourceProbes(
    cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics),
    metadata.serverDiagnostics,
  );
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    runtimeConfig: metadata.runtimeConfig,
    availableSkills: metadata.availableSkills,
    availablePermissionProfiles: metadata.availablePermissionProfiles,
    rateLimit: metadata.rateLimit,
    serverDiagnostics,
  });
}

async function refreshAppServerMetadata(host: ServerMetadataActionsHost): Promise<SharedServerMetadata | null> {
  let metadata: SharedServerMetadata | null;
  try {
    metadata = await host.refreshAppServerMetadata();
  } catch (error) {
    if (host.isStaleResourceContextError(error)) return null;
    throw error;
  }
  if (!metadata) return null;
  applyAppServerMetadata(host, metadata);
  return metadata;
}

function applyCurrentAppServerMetadataSnapshot(host: ServerMetadataActionsHost): void {
  const metadata = host.appServerMetadataSnapshot();
  if (metadata) applyAppServerMetadata(host, metadata);
}

async function refreshMetadataResource(
  host: ServerMetadataActionsHost,
  refresh: () => Promise<SharedServerMetadata | null>,
): Promise<void> {
  try {
    const metadata = await refresh();
    if (metadata) applyAppServerMetadata(host, metadata);
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

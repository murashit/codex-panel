import {
  cloneServerDiagnostics,
  diagnosticsWithMetadataResourceProbes,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
} from "../../../../domain/server/diagnostics";
import type { McpServerStartupStatus } from "../../../../domain/server/mcp-status";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { ChatStateStore } from "../state/store";
import type { MetadataResourceTransport, RateLimitMetadataProbeResult } from "./metadata-transport";

export type AppServerResourceEvent =
  | { type: "skills-changed"; forceReload: boolean }
  | { type: "rate-limits-updated"; preserveExistingOnFailure?: boolean }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ServerMetadataActionsHost {
  stateStore: ChatStateStore;
  metadataResourceTransport: MetadataResourceTransport;
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: (options?: { forceSkills?: boolean }) => Promise<SharedServerMetadata | null>;
  isStaleSharedQueryError: (error: unknown) => boolean;
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
      await applyAppServerResourceEvent(host, event);
    },
  };
}

async function applyAppServerResourceEvent(host: ServerMetadataActionsHost, event: AppServerResourceEvent): Promise<void> {
  switch (event.type) {
    case "skills-changed":
      await refreshSkillResource(host, event.forceReload);
      return;
    case "rate-limits-updated":
      await refreshRateLimitResource(host, { preserveExistingOnFailure: event.preserveExistingOnFailure === true });
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
    if (host.isStaleSharedQueryError(error)) return null;
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

async function refreshSkillResource(host: ServerMetadataActionsHost, forceReload = false): Promise<SharedServerMetadata | null> {
  const skills = await host.metadataResourceTransport.readSkillMetadata(forceReload);
  if (!skills) return null;
  const next = host.updateAppServerMetadata((metadata) => {
    if (!metadata) return null;
    return {
      ...metadata,
      ...(skills.probe.status === "ok" ? { availableSkills: skills.value } : {}),
      serverDiagnostics: diagnosticsWithProbe(cloneServerDiagnostics(metadata.serverDiagnostics), skills.probe),
    };
  });
  if (next) {
    applyAppServerMetadata(host, next);
    return next;
  }
  const diagnostics = diagnosticsWithProbe(currentMetadataDiagnostics(host), skills.probe);
  host.stateStore.dispatch(
    skills.probe.status === "ok"
      ? {
          type: "connection/metadata-applied",
          availableSkills: skills.value,
          serverDiagnostics: diagnostics,
        }
      : { type: "connection/metadata-applied", serverDiagnostics: diagnostics },
  );
  return null;
}

async function refreshRateLimitResource(
  host: ServerMetadataActionsHost,
  options: { preserveExistingOnFailure?: boolean } = {},
): Promise<void> {
  const rateLimit = await host.metadataResourceTransport.readRateLimitMetadata();
  if (!rateLimit) return;
  const preserveExistingOnFailure = options.preserveExistingOnFailure === true;
  const next = updateRateLimitMetadata(host, rateLimit, { preserveRateLimitOnFailure: preserveExistingOnFailure });
  if (next) {
    applyAppServerMetadata(host, next);
    return;
  }
  const diagnostics = diagnosticsWithProbe(currentMetadataDiagnostics(host), rateLimit.probe);
  host.stateStore.dispatch(
    preserveExistingOnFailure && rateLimit.probe.status !== "ok"
      ? { type: "connection/metadata-applied", serverDiagnostics: diagnostics }
      : {
          type: "connection/metadata-applied",
          rateLimit: rateLimit.value,
          serverDiagnostics: diagnostics,
        },
  );
}

function updateRateLimitMetadata(
  host: ServerMetadataActionsHost,
  rateLimit: RateLimitMetadataProbeResult,
  options: { preserveRateLimitOnFailure: boolean },
): SharedServerMetadata | null {
  return host.updateAppServerMetadata((metadata) => {
    if (!metadata) return null;
    const diagnostics = diagnosticsWithProbe(cloneServerDiagnostics(metadata.serverDiagnostics), rateLimit.probe);
    return {
      ...metadata,
      ...(rateLimit.probe.status === "ok" || !options.preserveRateLimitOnFailure ? { rateLimit: rateLimit.value } : {}),
      serverDiagnostics: diagnostics,
    };
  });
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

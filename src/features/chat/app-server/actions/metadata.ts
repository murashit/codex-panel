import {
  readRateLimitMetadataProbe,
  readSkillMetadataProbe,
  type RateLimitMetadataProbeResult,
} from "../../../../app-server/query/metadata-probes";
import { isStaleAppServerSharedQueryContextError } from "../../../../app-server/query/shared-queries";
import {
  cloneServerDiagnostics,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
  type McpServerStartupStatus,
} from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { captureChatServerActionClientScope, type ChatServerActionHost } from "./host";

export type AppServerResourceEvent =
  | { type: "skills-changed"; forceReload: boolean }
  | { type: "rate-limits-updated"; preserveExistingOnFailure?: boolean }
  | { type: "mcp-startup-status-updated"; name: string; status: McpServerStartupStatus; message: string | null };

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: (options?: { forceSkills?: boolean }) => Promise<SharedServerMetadata | null>;
}

export interface ChatServerMetadataActions {
  applyAppServerMetadata: (metadata: SharedServerMetadata) => void;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  applyAppServerResourceEvent: (event: AppServerResourceEvent) => Promise<void>;
}

export function createChatServerMetadataActions(host: ChatServerMetadataActionsHost): ChatServerMetadataActions {
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

async function applyAppServerResourceEvent(host: ChatServerMetadataActionsHost, event: AppServerResourceEvent): Promise<void> {
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

function applyAppServerMetadata(host: ChatServerMetadataActionsHost, metadata: SharedServerMetadata): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    runtimeConfig: metadata.runtimeConfig,
    availableModels: metadata.availableModels,
    availableSkills: metadata.availableSkills,
    rateLimit: metadata.rateLimit,
    serverDiagnostics: metadata.serverDiagnostics,
  });
}

async function refreshAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedServerMetadata | null> {
  let metadata: SharedServerMetadata | null;
  try {
    metadata = await host.refreshAppServerMetadata();
  } catch (error) {
    if (isStaleAppServerSharedQueryContextError(error)) return null;
    throw error;
  }
  if (!metadata) return null;
  applyAppServerMetadata(host, metadata);
  return metadata;
}

function applyCurrentAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  const metadata = host.appServerMetadataSnapshot();
  if (metadata) applyAppServerMetadata(host, metadata);
}

async function refreshSkillResource(host: ChatServerMetadataActionsHost, forceReload = false): Promise<SharedServerMetadata | null> {
  const scope = captureChatServerActionClientScope(host);
  const skills = await readSkillMetadataProbe(scope.client, host.vaultPath, forceReload);
  if (scope.isStale()) return null;
  const next = host.updateAppServerMetadata((metadata) => {
    if (!metadata) return null;
    return {
      ...metadata,
      availableSkills: skills.data,
      serverDiagnostics: diagnosticsWithProbe(cloneServerDiagnostics(metadata.serverDiagnostics), skills.probe),
    };
  });
  if (next) {
    applyAppServerMetadata(host, next);
    return next;
  }
  const diagnostics = diagnosticsWithProbe(currentMetadataDiagnostics(host), skills.probe);
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableSkills: skills.data,
    serverDiagnostics: diagnostics,
  });
  return null;
}

async function refreshRateLimitResource(
  host: ChatServerMetadataActionsHost,
  options: { preserveExistingOnFailure?: boolean } = {},
): Promise<void> {
  const scope = captureChatServerActionClientScope(host);
  const rateLimit = await readRateLimitMetadataProbe(scope.client);
  if (scope.isStale()) return;
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
          rateLimit: rateLimit.data,
          serverDiagnostics: diagnostics,
        },
  );
}

function updateRateLimitMetadata(
  host: ChatServerMetadataActionsHost,
  rateLimit: RateLimitMetadataProbeResult,
  options: { preserveRateLimitOnFailure: boolean },
): SharedServerMetadata | null {
  return host.updateAppServerMetadata((metadata) => {
    if (!metadata) return null;
    const diagnostics = diagnosticsWithProbe(cloneServerDiagnostics(metadata.serverDiagnostics), rateLimit.probe);
    return {
      ...metadata,
      ...(rateLimit.probe.status === "ok" || !options.preserveRateLimitOnFailure ? { rateLimit: rateLimit.data } : {}),
      serverDiagnostics: diagnostics,
    };
  });
}

function applyMcpStartupStatusEvent(
  host: ChatServerMetadataActionsHost,
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

function currentMetadataDiagnostics(host: ChatServerMetadataActionsHost): SharedServerMetadata["serverDiagnostics"] {
  return (
    host.appServerMetadataSnapshot()?.serverDiagnostics ?? cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics)
  );
}

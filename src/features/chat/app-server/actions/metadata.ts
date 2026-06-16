import {
  readRateLimitMetadataProbe,
  readSkillMetadataProbe,
  type RateLimitMetadataProbeResult,
} from "../../../../app-server/query/metadata-probes";
import { isStaleAppServerSharedQueryContextError } from "../../../../app-server/query/shared-queries";
import { cloneServerDiagnostics, diagnosticsWithProbe } from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { ChatServerActionHost } from "./host";

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: (options?: { forceSkills?: boolean }) => Promise<SharedServerMetadata | null>;
}

export interface ChatServerMetadataActions {
  applyAppServerMetadata: (metadata: SharedServerMetadata) => void;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  applyAppServerMetadataSnapshot: () => void;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshRateLimits: (options?: { preserveExistingOnFailure?: boolean }) => Promise<void>;
}

export function createChatServerMetadataActions(host: ChatServerMetadataActionsHost): ChatServerMetadataActions {
  return {
    applyAppServerMetadata: (metadata) => {
      applyAppServerMetadata(host, metadata);
    },
    refreshAppServerMetadata: () => refreshAppServerMetadata(host),
    applyAppServerMetadataSnapshot: () => {
      applyAppServerMetadataSnapshot(host);
    },
    refreshSkills: async (forceReload) => {
      await refreshSkills(host, forceReload);
    },
    refreshRateLimits: (options) => refreshRateLimits(host, options),
  };
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

function applyAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  const metadata = host.appServerMetadataSnapshot();
  if (metadata) applyAppServerMetadata(host, metadata);
}

async function refreshSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<SharedServerMetadata | null> {
  const client = host.currentClient();
  const skills = await readSkillMetadataProbe(client, host.vaultPath, forceReload);
  if (client && host.currentClient() !== client) return null;
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

async function refreshRateLimits(
  host: ChatServerMetadataActionsHost,
  options: { preserveExistingOnFailure?: boolean } = {},
): Promise<void> {
  const client = host.currentClient();
  const rateLimit = await readRateLimitMetadataProbe(client);
  if (client && host.currentClient() !== client) return;
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

function currentMetadataDiagnostics(host: ChatServerMetadataActionsHost): SharedServerMetadata["serverDiagnostics"] {
  return (
    host.appServerMetadataSnapshot()?.serverDiagnostics ?? cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics)
  );
}

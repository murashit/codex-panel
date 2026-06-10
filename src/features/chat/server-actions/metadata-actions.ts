import { type Diagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../../app-server/diagnostics";
import { listModelMetadata, listSkillCatalog } from "../../../app-server/resource-operations";
import { runtimeConfigSnapshotFromAppServerConfig } from "../../../app-server/runtime-config";
import { rateLimitSnapshotFromAppServerSnapshot } from "../../../app-server/runtime-metrics";
import type { SharedAppServerMetadata } from "../../../app-server/shared-cache-state";
import type { ModelMetadata, SkillMetadata } from "../../../domain/catalog/metadata";
import { cloneAppServerDiagnostics, type ChatServerActionHost } from "./shared";

interface RateLimitMetadataResult {
  data: SharedAppServerMetadata["rateLimit"];
  probe: Diagnostics["probes"]["account/rateLimits/read"];
}

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
}

export interface ChatServerMetadataActions {
  serverMetadataSnapshot: () => SharedAppServerMetadata;
  applyAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  loadAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshPublishedAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  publishAppServerMetadataSnapshot: () => void;
  refreshModels: () => Promise<void>;
  loadModels: () => Promise<{ data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] }>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshPublishedSkills: (forceReload?: boolean) => Promise<void>;
  loadSkills: (forceReload?: boolean) => Promise<{ data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] }>;
  refreshRateLimits: () => Promise<void>;
  refreshPublishedRateLimits: () => Promise<void>;
  loadRateLimit: () => Promise<RateLimitMetadataResult>;
}

export function createChatServerMetadataActions(host: ChatServerMetadataActionsHost): ChatServerMetadataActions {
  return {
    serverMetadataSnapshot: () => serverMetadataSnapshot(host),
    applyAppServerMetadata: (metadata) => {
      applyAppServerMetadata(host, metadata);
    },
    loadAppServerMetadata: () => loadAppServerMetadata(host),
    refreshAppServerMetadata: () => refreshAppServerMetadata(host),
    refreshPublishedAppServerMetadata: () => refreshPublishedAppServerMetadata(host),
    publishAppServerMetadataSnapshot: () => {
      publishAppServerMetadataSnapshot(host);
    },
    refreshModels: () => refreshModels(host),
    loadModels: () => loadModels(host),
    refreshSkills: (forceReload) => refreshSkills(host, forceReload),
    refreshPublishedSkills: (forceReload) => refreshPublishedSkills(host, forceReload),
    loadSkills: (forceReload) => loadSkills(host, forceReload),
    refreshRateLimits: () => refreshRateLimits(host),
    refreshPublishedRateLimits: () => refreshPublishedRateLimits(host),
    loadRateLimit: () => loadRateLimit(host),
  };
}

function serverMetadataSnapshot(host: ChatServerMetadataActionsHost): SharedAppServerMetadata {
  const state = host.stateStore.getState();
  return {
    runtimeConfig: state.connection.runtimeConfig,
    availableModels: state.connection.availableModels,
    availableSkills: state.connection.availableSkills,
    rateLimit: state.connection.rateLimit,
    appServerDiagnostics: state.connection.appServerDiagnostics,
  };
}

function applyAppServerMetadata(host: ChatServerMetadataActionsHost, metadata: SharedAppServerMetadata): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    runtimeConfig: metadata.runtimeConfig,
    availableModels: metadata.availableModels,
    availableSkills: metadata.availableSkills,
    rateLimit: metadata.rateLimit,
    appServerDiagnostics: metadata.appServerDiagnostics,
  });
}

async function loadAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  const runtimeConfig = runtimeConfigSnapshotFromAppServerConfig(await client.readEffectiveConfig(host.vaultPath));
  const [models, skills, rateLimit] = await Promise.all([loadModels(host), loadSkills(host), loadRateLimit(host)]);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  diagnostics.probes["skills/list"] = skills.probe;
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  return {
    runtimeConfig,
    availableModels: models.data,
    availableSkills: skills.data,
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  };
}

async function refreshAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const metadata = await loadAppServerMetadata(host);
  if (metadata) applyAppServerMetadata(host, metadata);
  return metadata;
}

async function refreshPublishedAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const metadata = await refreshAppServerMetadata(host);
  if (metadata) host.publishAppServerMetadata(metadata);
  return metadata;
}

function publishAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  host.publishAppServerMetadata(serverMetadataSnapshot(host));
}

async function refreshModels(host: ChatServerMetadataActionsHost): Promise<void> {
  const models = await loadModels(host);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableModels: models.data,
    appServerDiagnostics: diagnostics,
  });
}

async function loadModels(
  host: ChatServerMetadataActionsHost,
): Promise<{ data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] }> {
  const client = host.currentClient();
  if (!client) return { data: [], probe: diagnosticProbeError("model/list", new Error("Codex app-server is not connected.")) };
  try {
    const data = await listModelMetadata(client);
    return {
      data,
      probe: diagnosticProbeOk("model/list", `${String(data.length)} models`),
    };
  } catch (error) {
    return { data: [], probe: diagnosticProbeError("model/list", error) };
  }
}

async function refreshSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<void> {
  const skills = await loadSkills(host, forceReload);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["skills/list"] = skills.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableSkills: skills.data,
    appServerDiagnostics: diagnostics,
  });
}

async function refreshPublishedSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<void> {
  await refreshSkills(host, forceReload);
  publishAppServerMetadataSnapshot(host);
}

async function loadSkills(
  host: ChatServerMetadataActionsHost,
  forceReload = false,
): Promise<{ data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] }> {
  const client = host.currentClient();
  if (!client) return { data: [], probe: diagnosticProbeError("skills/list", new Error("Codex app-server is not connected.")) };
  try {
    const catalog = await listSkillCatalog(client, host.vaultPath, { forceReload });
    return { data: catalog.skills, probe: diagnosticProbeOk("skills/list", `${String(catalog.totalCount)} skills`) };
  } catch (error) {
    return { data: [], probe: diagnosticProbeError("skills/list", error) };
  }
}

async function refreshRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const rateLimit = await loadRateLimit(host);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  });
}

async function refreshPublishedRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const rateLimit = await loadRateLimit(host);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  if (rateLimit.probe.status === "ok") {
    host.stateStore.dispatch({
      type: "connection/metadata-applied",
      rateLimit: rateLimit.data,
      appServerDiagnostics: diagnostics,
    });
    publishAppServerMetadataSnapshot(host);
    return;
  }
  host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
}

async function loadRateLimit(host: ChatServerMetadataActionsHost): Promise<RateLimitMetadataResult> {
  const client = host.currentClient();
  if (!client) {
    return {
      data: null,
      probe: diagnosticProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
    };
  }
  try {
    const response = await client.readAccountRateLimits();
    const rateLimitsByLimitId = response.rateLimitsByLimitId;
    const codexRateLimit = rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, "codex") ? rateLimitsByLimitId["codex"] : undefined;
    const rateLimit = codexRateLimit ?? response.rateLimits;
    return {
      data: rateLimitSnapshotFromAppServerSnapshot(rateLimit),
      probe: diagnosticProbeOk(
        "account/rateLimits/read",
        response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available",
      ),
    };
  } catch (error) {
    return { data: null, probe: diagnosticProbeError("account/rateLimits/read", error) };
  }
}

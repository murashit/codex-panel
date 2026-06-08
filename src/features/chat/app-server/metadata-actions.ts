import { type AppServerDiagnostics, capabilityProbeError, capabilityProbeOk } from "../../../app-server/compatibility";
import type { Model } from "../../../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../../../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../../generated/app-server/v2/SkillMetadata";
import type { SharedAppServerMetadata } from "../../../runtime/shared-app-server-state";
import { cloneAppServerDiagnostics, type ChatAppServerBaseHost } from "./shared";

export interface ChatAppServerMetadataActionsHost extends ChatAppServerBaseHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
}

export interface ChatAppServerMetadataActions {
  appServerMetadataSnapshot: () => SharedAppServerMetadata;
  applyAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  loadAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshPublishedAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  publishAppServerMetadataSnapshot: () => void;
  refreshModels: () => Promise<void>;
  loadModels: () => Promise<{ data: Model[]; probe: AppServerDiagnostics["probes"]["model/list"] }>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshPublishedSkills: (forceReload?: boolean) => Promise<void>;
  loadSkills: (forceReload?: boolean) => Promise<{ data: SkillMetadata[]; probe: AppServerDiagnostics["probes"]["skills/list"] }>;
  refreshRateLimits: () => Promise<void>;
  refreshPublishedRateLimits: () => Promise<void>;
  loadRateLimit: () => Promise<{ data: RateLimitSnapshot | null; probe: AppServerDiagnostics["probes"]["account/rateLimits/read"] }>;
}

export function createChatAppServerMetadataActions(host: ChatAppServerMetadataActionsHost): ChatAppServerMetadataActions {
  return {
    appServerMetadataSnapshot: () => appServerMetadataSnapshot(host),
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

function appServerMetadataSnapshot(host: ChatAppServerMetadataActionsHost): SharedAppServerMetadata {
  const state = host.stateStore.getState();
  return {
    effectiveConfig: state.connection.effectiveConfig,
    availableModels: state.connection.availableModels,
    availableSkills: state.connection.availableSkills,
    rateLimit: state.connection.rateLimit,
    appServerDiagnostics: state.connection.appServerDiagnostics,
  };
}

function applyAppServerMetadata(host: ChatAppServerMetadataActionsHost, metadata: SharedAppServerMetadata): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    effectiveConfig: metadata.effectiveConfig,
    availableModels: metadata.availableModels,
    availableSkills: metadata.availableSkills,
    rateLimit: metadata.rateLimit,
    appServerDiagnostics: metadata.appServerDiagnostics,
  });
}

async function loadAppServerMetadata(host: ChatAppServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  const effectiveConfig = await client.readEffectiveConfig(host.vaultPath);
  const [models, skills, rateLimit] = await Promise.all([loadModels(host), loadSkills(host), loadRateLimit(host)]);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  diagnostics.probes["skills/list"] = skills.probe;
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  return {
    effectiveConfig,
    availableModels: models.data,
    availableSkills: skills.data,
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  };
}

async function refreshAppServerMetadata(host: ChatAppServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const metadata = await loadAppServerMetadata(host);
  if (metadata) applyAppServerMetadata(host, metadata);
  return metadata;
}

async function refreshPublishedAppServerMetadata(host: ChatAppServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const metadata = await refreshAppServerMetadata(host);
  if (metadata) host.publishAppServerMetadata(metadata);
  return metadata;
}

function publishAppServerMetadataSnapshot(host: ChatAppServerMetadataActionsHost): void {
  host.publishAppServerMetadata(appServerMetadataSnapshot(host));
}

async function refreshModels(host: ChatAppServerMetadataActionsHost): Promise<void> {
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
  host: ChatAppServerMetadataActionsHost,
): Promise<{ data: Model[]; probe: AppServerDiagnostics["probes"]["model/list"] }> {
  const client = host.currentClient();
  if (!client) return { data: [], probe: capabilityProbeError("model/list", new Error("Codex app-server is not connected.")) };
  try {
    const response = await client.listModels(false);
    return { data: response.data, probe: capabilityProbeOk("model/list", `${String(response.data.length)} models`) };
  } catch (error) {
    return { data: [], probe: capabilityProbeError("model/list", error) };
  }
}

async function refreshSkills(host: ChatAppServerMetadataActionsHost, forceReload = false): Promise<void> {
  const skills = await loadSkills(host, forceReload);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["skills/list"] = skills.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableSkills: skills.data,
    appServerDiagnostics: diagnostics,
  });
}

async function refreshPublishedSkills(host: ChatAppServerMetadataActionsHost, forceReload = false): Promise<void> {
  await refreshSkills(host, forceReload);
  publishAppServerMetadataSnapshot(host);
}

async function loadSkills(
  host: ChatAppServerMetadataActionsHost,
  forceReload = false,
): Promise<{ data: SkillMetadata[]; probe: AppServerDiagnostics["probes"]["skills/list"] }> {
  const client = host.currentClient();
  if (!client) return { data: [], probe: capabilityProbeError("skills/list", new Error("Codex app-server is not connected.")) };
  try {
    const response = await client.listSkills(host.vaultPath, forceReload);
    const data = response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
    const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
    return { data, probe: capabilityProbeOk("skills/list", `${String(count)} skills`) };
  } catch (error) {
    return { data: [], probe: capabilityProbeError("skills/list", error) };
  }
}

async function refreshRateLimits(host: ChatAppServerMetadataActionsHost): Promise<void> {
  const rateLimit = await loadRateLimit(host);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  });
}

async function refreshPublishedRateLimits(host: ChatAppServerMetadataActionsHost): Promise<void> {
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

async function loadRateLimit(
  host: ChatAppServerMetadataActionsHost,
): Promise<{ data: RateLimitSnapshot | null; probe: AppServerDiagnostics["probes"]["account/rateLimits/read"] }> {
  const client = host.currentClient();
  if (!client) {
    return {
      data: null,
      probe: capabilityProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
    };
  }
  try {
    const response = await client.readAccountRateLimits();
    const rateLimitsByLimitId = response.rateLimitsByLimitId;
    const codexRateLimit = rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, "codex") ? rateLimitsByLimitId["codex"] : undefined;
    return {
      data: codexRateLimit ?? response.rateLimits,
      probe: capabilityProbeOk(
        "account/rateLimits/read",
        response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available",
      ),
    };
  } catch (error) {
    return { data: null, probe: capabilityProbeError("account/rateLimits/read", error) };
  }
}

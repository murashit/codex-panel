import type { AppServerClient } from "../connection/client";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { accountRateLimitsSummaryFromResponse, rateLimitSnapshotFromAccountRateLimitsResponse } from "../protocol/runtime-metrics";
import { listModelMetadata, listSkillCatalog } from "./catalog";
import { cloneServerDiagnostics, diagnosticProbeError, diagnosticProbeOk, type Diagnostics } from "../../domain/server/diagnostics";
import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { SharedServerMetadata } from "../../domain/server/metadata";

interface MetadataProbeResult<T, K extends keyof Diagnostics["probes"]> {
  data: T;
  probe: Diagnostics["probes"][K];
}

export type ModelMetadataProbeResult = MetadataProbeResult<ModelMetadata[], "model/list">;
export type SkillMetadataProbeResult = MetadataProbeResult<SkillMetadata[], "skills/list">;
export type RateLimitMetadataProbeResult = MetadataProbeResult<RateLimitSnapshot | null, "account/rateLimits/read">;

export async function readAppServerMetadata(
  client: AppServerClient,
  vaultPath: string,
  currentDiagnostics: Diagnostics,
): Promise<SharedServerMetadata> {
  const runtimeConfig = runtimeConfigSnapshotFromAppServerConfig(await client.readEffectiveConfig(vaultPath));
  const [models, skills, rateLimit] = await Promise.all([
    readModelMetadataProbe(client),
    readSkillMetadataProbe(client, vaultPath),
    readRateLimitMetadataProbe(client),
  ]);
  const diagnostics = cloneServerDiagnostics(currentDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  diagnostics.probes["skills/list"] = skills.probe;
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  return {
    runtimeConfig,
    availableModels: models.data,
    availableSkills: skills.data,
    rateLimit: rateLimit.data,
    serverDiagnostics: diagnostics,
  };
}

export async function readModelMetadataProbe(client: AppServerClient | null): Promise<ModelMetadataProbeResult> {
  if (!client) return disconnectedModelsResult();
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

export async function readSkillMetadataProbe(
  client: AppServerClient | null,
  vaultPath: string,
  forceReload = false,
): Promise<SkillMetadataProbeResult> {
  if (!client) return disconnectedSkillsResult();
  try {
    const catalog = await listSkillCatalog(client, vaultPath, { forceReload });
    return { data: catalog.skills, probe: diagnosticProbeOk("skills/list", `${String(catalog.totalCount)} skills`) };
  } catch (error) {
    return { data: [], probe: diagnosticProbeError("skills/list", error) };
  }
}

export async function readRateLimitMetadataProbe(client: AppServerClient | null): Promise<RateLimitMetadataProbeResult> {
  if (!client) return disconnectedRateLimitResult();
  try {
    const response = await client.readAccountRateLimits();
    return {
      data: rateLimitSnapshotFromAccountRateLimitsResponse(response),
      probe: diagnosticProbeOk("account/rateLimits/read", accountRateLimitsSummaryFromResponse(response)),
    };
  } catch (error) {
    return { data: null, probe: diagnosticProbeError("account/rateLimits/read", error) };
  }
}

function disconnectedModelsResult(): ModelMetadataProbeResult {
  return { data: [], probe: diagnosticProbeError("model/list", new Error("Codex app-server is not connected.")) };
}

function disconnectedSkillsResult(): SkillMetadataProbeResult {
  return { data: [], probe: diagnosticProbeError("skills/list", new Error("Codex app-server is not connected.")) };
}

function disconnectedRateLimitResult(): RateLimitMetadataProbeResult {
  return {
    data: null,
    probe: diagnosticProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
  };
}

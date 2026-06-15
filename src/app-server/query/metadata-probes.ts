import type { AppServerClient } from "../connection/client";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { accountRateLimitsSummaryFromResponse, rateLimitSnapshotFromAccountRateLimitsResponse } from "../protocol/runtime-metrics";
import { listSkillCatalog } from "../catalog/data";
import { diagnosticProbeError, diagnosticProbeOk, type Diagnostics } from "../../domain/server/diagnostics";
import type { SkillMetadata } from "../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";

interface MetadataProbeResult<T, K extends keyof Diagnostics["probes"]> {
  data: T;
  probe: Diagnostics["probes"][K];
}

export type SkillMetadataProbeResult = MetadataProbeResult<SkillMetadata[], "skills/list">;
export type RateLimitMetadataProbeResult = MetadataProbeResult<RateLimitSnapshot | null, "account/rateLimits/read">;

export async function readRuntimeConfigSnapshot(client: AppServerClient | null, vaultPath: string): Promise<RuntimeConfigSnapshot | null> {
  if (!client) return null;
  return runtimeConfigSnapshotFromAppServerConfig(await client.readEffectiveConfig(vaultPath));
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

function disconnectedSkillsResult(): SkillMetadataProbeResult {
  return { data: [], probe: diagnosticProbeError("skills/list", new Error("Codex app-server is not connected.")) };
}

function disconnectedRateLimitResult(): RateLimitMetadataProbeResult {
  return {
    data: null,
    probe: diagnosticProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
  };
}

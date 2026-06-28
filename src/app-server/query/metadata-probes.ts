import type { SkillMetadata } from "../../domain/catalog/metadata";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import { type Diagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../domain/server/diagnostics";
import { accountRateLimitsSummaryFromResponse, rateLimitSnapshotFromAccountRateLimitsResponse } from "../protocol/runtime-metrics";
import { listSkillCatalog } from "../services/catalog";
import type { AppServerRequestClient } from "../services/request-client";
import { readAccountRateLimits } from "../services/runtime-metrics";

interface MetadataProbeResult<T, K extends keyof Diagnostics["probes"]> {
  value: T;
  probe: Diagnostics["probes"][K];
}

export type SkillMetadataProbeResult = MetadataProbeResult<SkillMetadata[], "skills/list">;
export type RateLimitMetadataProbeResult = MetadataProbeResult<RateLimitSnapshot | null, "account/rateLimits/read">;

export async function readSkillMetadataProbe(
  client: AppServerRequestClient | null,
  vaultPath: string,
  forceReload = false,
): Promise<SkillMetadataProbeResult> {
  if (!client) {
    return { value: [], probe: diagnosticProbeError("skills/list", new Error("Codex app-server is not connected."), Date.now()) };
  }
  try {
    const catalog = await listSkillCatalog(client, vaultPath, { forceReload });
    return { value: catalog.skills, probe: diagnosticProbeOk("skills/list", `${String(catalog.totalCount)} skills`, Date.now()) };
  } catch (error) {
    return { value: [], probe: diagnosticProbeError("skills/list", error, Date.now()) };
  }
}

export async function readRateLimitMetadataProbe(client: AppServerRequestClient | null): Promise<RateLimitMetadataProbeResult> {
  if (!client) {
    return {
      value: null,
      probe: diagnosticProbeError("account/rateLimits/read", new Error("Codex app-server is not connected."), Date.now()),
    };
  }
  try {
    const response = await readAccountRateLimits(client);
    return {
      value: rateLimitSnapshotFromAccountRateLimitsResponse(response),
      probe: diagnosticProbeOk("account/rateLimits/read", accountRateLimitsSummaryFromResponse(response), Date.now()),
    };
  } catch (error) {
    return { value: null, probe: diagnosticProbeError("account/rateLimits/read", error, Date.now()) };
  }
}

import type { SkillMetadata } from "../../domain/catalog/metadata";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../domain/runtime/permissions";
import { type Diagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../domain/server/diagnostics";
import { accountRateLimitsSummaryFromResponse, rateLimitSnapshotFromAccountRateLimitsResponse } from "../protocol/runtime-metrics";
import { listPermissionProfiles, listSkillCatalog } from "../services/catalog";
import type { AppServerRequestClient } from "../services/request-client";
import { readAccountRateLimits } from "../services/runtime-metadata";

interface MetadataProbeResult<T, K extends keyof Diagnostics["probes"]> {
  value: T;
  probe: Diagnostics["probes"][K];
}

export type SkillMetadataProbeResult = MetadataProbeResult<SkillMetadata[], "skills">;
export type PermissionProfileMetadataProbeResult = MetadataProbeResult<RuntimePermissionProfileSummary[], "permissionProfiles">;
export type RateLimitMetadataProbeResult = MetadataProbeResult<RateLimitSnapshot | null, "rateLimits">;

export async function readSkillMetadataProbe(
  client: AppServerRequestClient | null,
  vaultPath: string,
  forceReload = false,
): Promise<SkillMetadataProbeResult> {
  if (!client) {
    return { value: [], probe: diagnosticProbeError("skills", new Error("Codex app-server is not connected."), Date.now()) };
  }
  try {
    const catalog = await listSkillCatalog(client, vaultPath, { forceReload });
    return { value: catalog.skills, probe: diagnosticProbeOk("skills", `${String(catalog.totalCount)} skills`, Date.now()) };
  } catch (error) {
    return { value: [], probe: diagnosticProbeError("skills", error, Date.now()) };
  }
}

export async function readPermissionProfileMetadataProbe(
  client: AppServerRequestClient | null,
  vaultPath: string,
): Promise<PermissionProfileMetadataProbeResult> {
  if (!client) {
    return {
      value: [],
      probe: diagnosticProbeError("permissionProfiles", new Error("Codex app-server is not connected."), Date.now()),
    };
  }
  try {
    const profiles = await listPermissionProfiles(client, vaultPath);
    return { value: profiles, probe: diagnosticProbeOk("permissionProfiles", `${String(profiles.length)} profiles`, Date.now()) };
  } catch (error) {
    return { value: [], probe: diagnosticProbeError("permissionProfiles", error, Date.now()) };
  }
}

export async function readRateLimitMetadataProbe(client: AppServerRequestClient | null): Promise<RateLimitMetadataProbeResult> {
  if (!client) {
    return {
      value: null,
      probe: diagnosticProbeError("rateLimits", new Error("Codex app-server is not connected."), Date.now()),
    };
  }
  try {
    const response = await readAccountRateLimits(client);
    return {
      value: rateLimitSnapshotFromAccountRateLimitsResponse(response),
      probe: diagnosticProbeOk("rateLimits", accountRateLimitsSummaryFromResponse(response), Date.now()),
    };
  } catch (error) {
    return { value: null, probe: diagnosticProbeError("rateLimits", error, Date.now()) };
  }
}

import type { AppServerClient } from "../connection/client";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import {
  appServerHookOperationFromHookItem,
  hookItemsFromCatalogHooks,
  modelMetadataFromCatalogModels,
  skillMetadataFromCatalogSkills,
} from "../protocol/catalog";
import type { HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";

export interface HookData {
  hooks: HookItem[];
  warnings: string[];
  errors: string[];
}

interface ModelMetadataClient {
  listModels(includeHidden: boolean): Promise<ModelListResponse>;
}

export async function listModelMetadata(client: ModelMetadataClient, options: { includeHidden?: boolean } = {}): Promise<ModelMetadata[]> {
  const response = await client.listModels(options.includeHidden ?? false);
  return modelMetadataFromCatalogModels(response.data);
}

export async function listSkillCatalog(
  client: AppServerClient,
  cwd: string,
  options: { forceReload?: boolean; enabledOnly?: boolean } = {},
): Promise<{ skills: SkillMetadata[]; totalCount: number }> {
  const response = await client.listSkills(cwd, options.forceReload ?? false);
  const skills = response.data.flatMap((entry) => entry.skills);
  return {
    skills: skillMetadataFromCatalogSkills(options.enabledOnly === false ? skills : skills.filter((skill) => skill.enabled)),
    totalCount: skills.length,
  };
}

export async function listHookData(client: AppServerClient, cwd: string): Promise<HookData> {
  const response = await client.listHooks(cwd);
  const entry = response.data.find((item) => item.cwd === cwd);
  if (!entry) return { hooks: [], warnings: [], errors: [] };
  return {
    hooks: hookItemsFromCatalogHooks(entry.hooks),
    warnings: entry.warnings,
    errors: entry.errors.map((error) => JSON.stringify(error)),
  };
}

export async function trustHookItem(client: AppServerClient, hook: HookItem): Promise<void> {
  await client.trustHook(appServerHookOperationFromHookItem(hook));
}

export async function setHookItemEnabled(client: AppServerClient, hook: HookItem, enabled: boolean): Promise<void> {
  await client.setHookEnabled(appServerHookOperationFromHookItem(hook), enabled);
}

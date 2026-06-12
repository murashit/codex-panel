import type { AppServerClient } from "./client";
import {
  appServerHookOperationFromHookItem,
  hookItemsFromCatalogHooks,
  modelMetadataFromCatalogModels,
  skillMetadataFromCatalogSkills,
} from "./catalog";
import { threadFromThreadRecord, threadsFromThreadRecords } from "./thread";
import type { HookItem, ModelMetadata, SkillMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";

export interface HookData {
  hooks: HookItem[];
  warnings: string[];
  errors: string[];
}

export async function listThreads(client: AppServerClient, cwd: string, options: { archived?: boolean } = {}): Promise<Thread[]> {
  const archived = options.archived ?? false;
  const response = await client.listThreads(cwd, archived);
  return threadsFromThreadRecords(response.data, { archived });
}

export async function listModelMetadata(client: AppServerClient, options: { includeHidden?: boolean } = {}): Promise<ModelMetadata[]> {
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

export async function restoreArchivedThread(client: AppServerClient, threadId: string): Promise<Thread> {
  const response = await client.unarchiveThread(threadId);
  return threadFromThreadRecord(response.thread);
}

import type { AppServerClient } from "./client";
import {
  appServerHookOperationFromPanelHookItem,
  panelHookItemsFromAppServerHooks,
  panelModelOptionsFromAppServerModels,
  panelSkillOptionsFromAppServerSkills,
} from "./catalog-model";
import { panelThreadFromAppServerThread, panelThreadsFromAppServerThreads } from "./thread-model";
import type { PanelHookItem, PanelModelOption, PanelSkillOption } from "../domain/catalog/metadata";
import type { PanelThread } from "../domain/threads/model";

export interface PanelHookData {
  hooks: PanelHookItem[];
  warnings: string[];
  errors: string[];
}

export async function listPanelThreads(client: AppServerClient, cwd: string, options: { archived?: boolean } = {}): Promise<PanelThread[]> {
  const archived = options.archived ?? false;
  const response = await client.listThreads(cwd, archived);
  return panelThreadsFromAppServerThreads(response.data, { archived });
}

export async function listPanelModelOptions(
  client: AppServerClient,
  options: { includeHidden?: boolean } = {},
): Promise<PanelModelOption[]> {
  const response = await client.listModels(options.includeHidden ?? false);
  return panelModelOptionsFromAppServerModels(response.data);
}

export async function listPanelSkillCatalog(
  client: AppServerClient,
  cwd: string,
  options: { forceReload?: boolean; enabledOnly?: boolean } = {},
): Promise<{ skills: PanelSkillOption[]; totalCount: number }> {
  const response = await client.listSkills(cwd, options.forceReload ?? false);
  const skills = response.data.flatMap((entry) => entry.skills);
  return {
    skills: panelSkillOptionsFromAppServerSkills(options.enabledOnly === false ? skills : skills.filter((skill) => skill.enabled)),
    totalCount: skills.length,
  };
}

export async function listPanelHookData(client: AppServerClient, cwd: string): Promise<PanelHookData> {
  const response = await client.listHooks(cwd);
  const entry = response.data.find((item) => item.cwd === cwd);
  if (!entry) return { hooks: [], warnings: [], errors: [] };
  return {
    hooks: panelHookItemsFromAppServerHooks(entry.hooks),
    warnings: entry.warnings,
    errors: entry.errors.map((error) => JSON.stringify(error)),
  };
}

export async function trustPanelHook(client: AppServerClient, hook: PanelHookItem): Promise<void> {
  await client.trustHook(appServerHookOperationFromPanelHookItem(hook));
}

export async function setPanelHookEnabled(client: AppServerClient, hook: PanelHookItem, enabled: boolean): Promise<void> {
  await client.setHookEnabled(appServerHookOperationFromPanelHookItem(hook), enabled);
}

export async function restoreArchivedPanelThread(client: AppServerClient, threadId: string): Promise<PanelThread> {
  const response = await client.unarchiveThread(threadId);
  return panelThreadFromAppServerThread(response.thread);
}

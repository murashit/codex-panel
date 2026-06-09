import type { AppServerClient } from "../app-server/client";
import { loadPanelHooksForCwd, loadPanelModelOptions } from "../app-server/catalog-data";
import { appServerHookOperationFromPanelHookItem } from "../app-server/catalog-model";
import { panelThreadFromAppServerThread, panelThreadsFromAppServerThreads } from "../app-server/thread-model";
import type { PanelHookItem, PanelModelOption } from "../domain/catalog/metadata";
import type { PanelThread } from "../domain/threads/model";
import { errorMessage } from "../utils";

export interface LoadedHooks {
  hooks: PanelHookItem[];
  warnings: string[];
  errors: string[];
  status: string;
}

export interface SettingsDataLoad {
  models: SettledSettingsData<PanelModelOption[]>;
  hooks: SettledSettingsData<LoadedHooks>;
  archivedThreads: SettledSettingsData<PanelThread[]>;
}

type SettledSettingsData<T> =
  | {
      ok: true;
      data: T;
      status: string;
    }
  | {
      ok: false;
      status: string;
    };

export async function loadSettingsData(client: AppServerClient, cwd: string): Promise<SettingsDataLoad> {
  const [modelsResult, hooksResult, archivedThreadsResult] = await Promise.allSettled([
    loadPanelModelOptions(client, false),
    loadPanelHooksForCwd(client, cwd),
    client.listThreads(cwd, true),
  ] as const);

  return {
    models:
      modelsResult.status === "fulfilled"
        ? {
            ok: true,
            data: modelsResult.value,
            status: `Loaded ${String(modelsResult.value.length)} model${modelsResult.value.length === 1 ? "" : "s"}.`,
          }
        : { ok: false, status: `Could not load models: ${errorMessage(modelsResult.reason)}` },
    hooks:
      hooksResult.status === "fulfilled"
        ? settledHooks(hooksResult.value)
        : { ok: false, status: `Could not load hooks: ${errorMessage(hooksResult.reason)}` },
    archivedThreads:
      archivedThreadsResult.status === "fulfilled"
        ? {
            ok: true,
            data: panelThreadsFromAppServerThreads(archivedThreadsResult.value.data, { archived: true }),
            status: `Loaded ${String(archivedThreadsResult.value.data.length)} archived thread${archivedThreadsResult.value.data.length === 1 ? "" : "s"}.`,
          }
        : { ok: false, status: `Could not load archived threads: ${errorMessage(archivedThreadsResult.reason)}` },
  };
}

export async function loadHookData(client: AppServerClient, cwd: string): Promise<LoadedHooks> {
  const hooks = await loadPanelHooksForCwd(client, cwd);
  return {
    ...hooks,
    status: hooksStatus(hooks.hooks.length),
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

function hooksStatus(count: number): string {
  return `Loaded ${String(count)} hook${count === 1 ? "" : "s"}.`;
}

function settledHooks(hooks: Omit<LoadedHooks, "status">): SettledSettingsData<LoadedHooks> {
  return {
    ok: true,
    data: {
      ...hooks,
      status: hooksStatus(hooks.hooks.length),
    },
    status: hooksStatus(hooks.hooks.length),
  };
}

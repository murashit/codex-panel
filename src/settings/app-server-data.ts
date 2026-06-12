import type { AppServerClient } from "../app-server/connection/client";
import { listHookData, listModelMetadata, listThreads, type HookData } from "../app-server/services/resource-operations";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { errorMessage } from "../utils";

export interface LoadedHooks extends HookData {
  status: string;
}

export interface SettingsDataLoad {
  models: SettledSettingsData<ModelMetadata[]>;
  hooks: SettledSettingsData<LoadedHooks>;
  archivedThreads: SettledSettingsData<Thread[]>;
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
    listModelMetadata(client),
    listHookData(client, cwd),
    listThreads(client, cwd, { archived: true }),
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
            data: archivedThreadsResult.value,
            status: `Loaded ${String(archivedThreadsResult.value.length)} archived thread${archivedThreadsResult.value.length === 1 ? "" : "s"}.`,
          }
        : { ok: false, status: `Could not load archived threads: ${errorMessage(archivedThreadsResult.reason)}` },
  };
}

export async function loadHookData(client: AppServerClient, cwd: string): Promise<LoadedHooks> {
  const hooks = await listHookData(client, cwd);
  return {
    ...hooks,
    status: hooksStatus(hooks.hooks.length),
  };
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

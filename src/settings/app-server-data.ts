import type { AppServerClient } from "../app-server/connection/client";
import { listHookData, type HookData } from "../app-server/catalog";
import { listThreads } from "../app-server/threads";
import type { Thread } from "../domain/threads/model";
import { errorMessage } from "../utils";

export interface LoadedHooks extends HookData {
  status: string;
}

export interface SettingsCompanionDataLoad {
  hooks: SettledSettingsData<HookData>;
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

export async function loadSettingsCompanionData(client: AppServerClient, cwd: string): Promise<SettingsCompanionDataLoad> {
  const [hooksResult, archivedThreadsResult] = await Promise.allSettled([
    listHookData(client, cwd),
    listThreads(client, cwd, { archived: true }),
  ] as const);

  return {
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

function settledHooks(hooks: HookData): SettledSettingsData<HookData> {
  return {
    ok: true,
    data: hooks,
    status: hooksStatus(hooks.hooks.length),
  };
}

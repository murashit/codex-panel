import type { AppServerClient } from "../app-server/client";
import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Model } from "../generated/app-server/v2/Model";
import type { Thread } from "../generated/app-server/v2/Thread";
import { errorMessage } from "../utils";

export interface LoadedHooks {
  hooks: HookMetadata[];
  warnings: string[];
  errors: string[];
  status: string;
}

export interface SettingsDataLoad {
  models: SettledSettingsData<Model[]>;
  hooks: SettledSettingsData<LoadedHooks>;
  archivedThreads: SettledSettingsData<Thread[]>;
}

export type SettledSettingsData<T> =
  | {
      ok: true;
      data: T;
      status: string;
    }
  | {
      ok: false;
      status: string;
    };

export type SettingsDataRefreshLifecycleState = { kind: "idle" } | { kind: "loading" } | { kind: "completed"; failedCount: number };

export type SettingsDataRefreshLifecycleEvent = { type: "started" } | { type: "completed"; failedCount: number };

export type SettingsDynamicSectionLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string; operationId: number }
  | { kind: "loaded"; status: string; operationId: number }
  | { kind: "failed"; status: string; operationId: number };

export type SettingsDynamicSectionLifecycleEvent =
  | { type: "started"; status: string; operationId: number }
  | { type: "loaded"; status: string; operationId: number }
  | { type: "failed"; status: string; operationId: number }
  | { type: "reset" };

export function transitionSettingsDataRefreshLifecycle(
  state: SettingsDataRefreshLifecycleState,
  event: SettingsDataRefreshLifecycleEvent,
): SettingsDataRefreshLifecycleState {
  switch (event.type) {
    case "started":
      return state.kind === "loading" ? state : { kind: "loading" };
    case "completed":
      return { kind: "completed", failedCount: event.failedCount };
  }
}

export function settingsDataRefreshLoading(state: SettingsDataRefreshLifecycleState): boolean {
  return state.kind === "loading";
}

export function createSettingsDynamicSectionLifecycle(): SettingsDynamicSectionLifecycleState {
  return { kind: "idle", status: "" };
}

export function transitionSettingsDynamicSectionLifecycle(
  state: SettingsDynamicSectionLifecycleState,
  event: SettingsDynamicSectionLifecycleEvent,
): SettingsDynamicSectionLifecycleState {
  switch (event.type) {
    case "started":
      return { kind: "loading", status: event.status, operationId: event.operationId };
    case "loaded":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationId)) return state;
      return { kind: "loaded", status: event.status, operationId: event.operationId };
    case "failed":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationId)) return state;
      return { kind: "failed", status: event.status, operationId: event.operationId };
    case "reset":
      return createSettingsDynamicSectionLifecycle();
  }
}

function isStaleSettingsDynamicSectionEvent(state: SettingsDynamicSectionLifecycleState, operationId: number): boolean {
  return "operationId" in state && state.operationId > operationId;
}

export async function loadSettingsData(client: AppServerClient, cwd: string): Promise<SettingsDataLoad> {
  const [modelsResult, hooksResult, archivedThreadsResult] = await Promise.allSettled([
    client.listModels(false),
    client.listHooks(cwd),
    client.listThreads(cwd, true),
  ] as const);

  return {
    models:
      modelsResult.status === "fulfilled"
        ? {
            ok: true,
            data: modelsResult.value.data,
            status: `Loaded ${String(modelsResult.value.data.length)} model${modelsResult.value.data.length === 1 ? "" : "s"}.`,
          }
        : { ok: false, status: `Could not load models: ${errorMessage(modelsResult.reason)}` },
    hooks:
      hooksResult.status === "fulfilled"
        ? settledHooks(hooksResult.value.data, cwd)
        : { ok: false, status: `Could not load hooks: ${errorMessage(hooksResult.reason)}` },
    archivedThreads:
      archivedThreadsResult.status === "fulfilled"
        ? {
            ok: true,
            data: archivedThreadsResult.value.data,
            status: `Loaded ${String(archivedThreadsResult.value.data.length)} archived thread${archivedThreadsResult.value.data.length === 1 ? "" : "s"}.`,
          }
        : { ok: false, status: `Could not load archived threads: ${errorMessage(archivedThreadsResult.reason)}` },
  };
}

export async function loadHookData(client: AppServerClient, cwd: string): Promise<LoadedHooks> {
  const response = await client.listHooks(cwd);
  const hooks = hooksForCwd(response.data, cwd);
  return {
    ...hooks,
    status: hooksStatus(hooks.hooks.length),
  };
}

function hooksForCwd(entries: Awaited<ReturnType<AppServerClient["listHooks"]>>["data"], cwd: string): Omit<LoadedHooks, "status"> {
  const entry = entries.find((item) => item.cwd === cwd);
  if (!entry) return { hooks: [], warnings: [], errors: [] };
  return {
    hooks: entry.hooks,
    warnings: entry.warnings,
    errors: entry.errors.map((error) => JSON.stringify(error)),
  };
}

function hooksStatus(count: number): string {
  return `Loaded ${String(count)} hook${count === 1 ? "" : "s"}.`;
}

function settledHooks(entries: Awaited<ReturnType<AppServerClient["listHooks"]>>["data"], cwd: string): SettledSettingsData<LoadedHooks> {
  const hooks = hooksForCwd(entries, cwd);
  return {
    ok: true,
    data: {
      ...hooks,
      status: hooksStatus(hooks.hooks.length),
    },
    status: hooksStatus(hooks.hooks.length),
  };
}

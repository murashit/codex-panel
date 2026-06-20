import type { AppServerClient } from "../app-server/connection/client";
import { listHookData, type HookData } from "../app-server/catalog";

export interface LoadedHooks extends HookData {
  status: string;
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

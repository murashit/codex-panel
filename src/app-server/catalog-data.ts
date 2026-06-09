import type { AppServerClient } from "./client";
import { panelHookItemsFromAppServerHooks, panelModelOptionsFromAppServerModels } from "./catalog-model";
import type { PanelHookItem, PanelModelOption } from "../domain/catalog/model";

export interface PanelHooksForCwd {
  hooks: PanelHookItem[];
  warnings: string[];
  errors: string[];
}

export async function loadPanelModelOptions(client: AppServerClient, includeHidden = false): Promise<PanelModelOption[]> {
  const response = await client.listModels(includeHidden);
  return panelModelOptionsFromAppServerModels(response.data);
}

export async function loadPanelHooksForCwd(client: AppServerClient, cwd: string): Promise<PanelHooksForCwd> {
  const response = await client.listHooks(cwd);
  const entry = response.data.find((item) => item.cwd === cwd);
  if (!entry) return { hooks: [], warnings: [], errors: [] };
  return {
    hooks: panelHookItemsFromAppServerHooks(entry.hooks),
    warnings: entry.warnings,
    errors: entry.errors.map((error) => JSON.stringify(error)),
  };
}

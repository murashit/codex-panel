import type { HookCatalog, HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../domain/runtime/permissions";
import type { ClientRequestParams } from "../connection/rpc-messages";
import { hookItemsFromCatalogHooks, modelMetadataFromCatalogModels, skillMetadataFromCatalogSkills } from "../protocol/catalog";
import { collectCursorPages } from "./cursor-pages";
import type { AppServerRequestClient } from "./request-client";

export interface ModelMetadataClient {
  request: AppServerRequestClient["request"];
}

export async function listModelMetadata(client: ModelMetadataClient, options: { includeHidden?: boolean } = {}): Promise<ModelMetadata[]> {
  const models = await collectCursorPages(
    (cursor) => client.request("model/list", { includeHidden: options.includeHidden ?? false, cursor, limit: 100 }),
    "model list",
  );

  return modelMetadataFromCatalogModels(models);
}

export async function listPermissionProfiles(client: AppServerRequestClient, cwd: string): Promise<RuntimePermissionProfileSummary[]> {
  return collectCursorPages(async (cursor) => {
    const response = await client.request("permissionProfile/list", { cwd, cursor, limit: 100 });
    return { ...response, data: response.data.map((profile) => ({ ...profile })) };
  }, "permission profile list");
}

export async function listSkillCatalog(
  client: AppServerRequestClient,
  cwd: string,
  options: { forceReload?: boolean; enabledOnly?: boolean } = {},
): Promise<{ skills: SkillMetadata[]; totalCount: number }> {
  const response = await client.request("skills/list", {
    cwds: [cwd],
    forceReload: options.forceReload ?? false,
  });
  const skills = response.data.flatMap((entry) => entry.skills);
  return {
    skills: skillMetadataFromCatalogSkills(options.enabledOnly === false ? skills : skills.filter((skill) => skill.enabled)),
    totalCount: skills.length,
  };
}

export async function listHookCatalog(client: AppServerRequestClient, cwd: string): Promise<HookCatalog> {
  const response = await client.request("hooks/list", { cwds: [cwd] });
  const entry = response.data.find((item) => item.cwd === cwd);
  if (!entry) return { hooks: [], warnings: [], errors: [] };
  return {
    hooks: hookItemsFromCatalogHooks(entry.hooks),
    warnings: entry.warnings,
    errors: entry.errors.map((error) => JSON.stringify(error)),
  };
}

export async function trustHookItem(client: AppServerRequestClient, hook: HookItem): Promise<void> {
  await writeHookState(client, hook.key, {
    trusted_hash: hook.currentHash,
  });
}

export async function setHookItemEnabled(client: AppServerRequestClient, hook: HookItem, enabled: boolean): Promise<void> {
  if (hook.isManaged) throw new Error("Managed hooks cannot be enabled or disabled here.");
  if (hook.trustStatus !== "trusted") throw new Error("Trust the current hook definition before enabling it.");
  await writeHookState(client, hook.key, { enabled });
}

type HookConfigState = Record<string, string | boolean | null>;
type ConfigBatchWriteParams = ClientRequestParams<"config/batchWrite">;

function writeHookState(client: AppServerRequestClient, key: HookItem["key"], state: HookConfigState): Promise<unknown> {
  const params: ConfigBatchWriteParams = {
    edits: [
      {
        keyPath: "hooks.state",
        value: {
          [key]: state,
        },
        mergeStrategy: "upsert",
      },
    ],
    reloadUserConfig: true,
  };
  return client.request("config/batchWrite", params);
}

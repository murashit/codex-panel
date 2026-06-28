import type { HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import type { ClientRequestParams } from "../connection/rpc-messages";
import {
  type AppServerHookOperation,
  appServerHookOperationFromHookItem,
  hookItemsFromCatalogHooks,
  modelMetadataFromCatalogModels,
  skillMetadataFromCatalogSkills,
} from "../protocol/catalog";
import type { AppServerRequestClient } from "./request-client";

export interface HookCatalog {
  hooks: HookItem[];
  warnings: string[];
  errors: string[];
}

export interface ModelMetadataClient {
  request: AppServerRequestClient["request"];
}

export async function listModelMetadata(client: ModelMetadataClient, options: { includeHidden?: boolean } = {}): Promise<ModelMetadata[]> {
  const response = await client.request("model/list", {
    includeHidden: options.includeHidden ?? false,
    limit: 100,
  });
  return modelMetadataFromCatalogModels(response.data);
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
  const operation = appServerHookOperationFromHookItem(hook);
  await writeHookState(client, operation.key, {
    enabled: true,
    trusted_hash: operation.currentHash,
  });
}

export async function setHookItemEnabled(client: AppServerRequestClient, hook: HookItem, enabled: boolean): Promise<void> {
  const operation = appServerHookOperationFromHookItem(hook);
  const state: HookConfigState = operation.trustStatus === "trusted" ? { enabled, trusted_hash: operation.currentHash } : { enabled };
  await writeHookState(client, operation.key, state);
}

type HookConfigState = Record<string, string | boolean | null>;
type ConfigBatchWriteParams = ClientRequestParams<"config/batchWrite">;

function writeHookState(client: AppServerRequestClient, key: AppServerHookOperation["key"], state: HookConfigState): Promise<unknown> {
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
  return client.request("config/batchWrite", {
    ...params,
  });
}

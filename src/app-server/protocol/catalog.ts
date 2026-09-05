import type { HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import type { HookMetadata } from "../../generated/app-server/v2/HookMetadata";
import type { Model } from "../../generated/app-server/v2/Model";
import type { SkillMetadata as GeneratedSkillMetadata } from "../../generated/app-server/v2/SkillMetadata";

export type CatalogModel = Pick<
  Model,
  | "id"
  | "model"
  | "displayName"
  | "description"
  | "hidden"
  | "supportedReasoningEfforts"
  | "defaultReasoningEffort"
  | "inputModalities"
  | "serviceTiers"
  | "defaultServiceTier"
  | "isDefault"
>;

export type CatalogSkillMetadata = Pick<
  GeneratedSkillMetadata,
  "name" | "description" | "shortDescription" | "interface" | "path" | "enabled"
>;

export type CatalogHookMetadata = Pick<
  HookMetadata,
  "key" | "eventName" | "matcher" | "statusMessage" | "sourcePath" | "enabled" | "isManaged" | "currentHash" | "trustStatus"
> &
  (
    | Pick<Extract<HookMetadata, { handlerType: "command" }>, "handlerType" | "command">
    | Pick<Extract<HookMetadata, { handlerType: "mcpTool" }>, "handlerType" | "server" | "tool">
    | Pick<Extract<HookMetadata, { handlerType: "prompt" | "agent" }>, "handlerType">
  );

export type AppServerHookOperation = Pick<HookMetadata, "key" | "currentHash" | "trustStatus">;

function modelMetadataFromCatalogModel(model: CatalogModel): ModelMetadata {
  return {
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    description: model.description,
    hidden: model.hidden,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => ({
      reasoningEffort: option.reasoningEffort,
      description: option.description,
    })),
    defaultReasoningEffort: model.defaultReasoningEffort,
    inputModalities: [...model.inputModalities],
    serviceTiers: model.serviceTiers.map((tier) => ({ id: tier.id, name: tier.name })),
    defaultServiceTier: model.defaultServiceTier,
    isDefault: model.isDefault,
  };
}

export function modelMetadataFromCatalogModels(models: readonly CatalogModel[]): ModelMetadata[] {
  return models.map((model) => modelMetadataFromCatalogModel(model));
}

function skillMetadataFromCatalogSkill(skill: CatalogSkillMetadata): SkillMetadata {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.interface?.shortDescription !== undefined ? { interfaceShortDescription: skill.interface.shortDescription } : {}),
    path: skill.path,
    enabled: skill.enabled,
  };
}

export function skillMetadataFromCatalogSkills(skills: readonly CatalogSkillMetadata[]): SkillMetadata[] {
  return skills.map((skill) => skillMetadataFromCatalogSkill(skill));
}

function hookItemFromCatalogHook(hook: CatalogHookMetadata): HookItem {
  return {
    key: hook.key,
    eventName: hook.eventName,
    matcher: hook.matcher,
    handlerSummary: hookHandlerSummary(hook),
    statusMessage: hook.statusMessage,
    sourcePath: hook.sourcePath,
    enabled: hook.enabled,
    isManaged: hook.isManaged,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus,
  };
}

function hookHandlerSummary(hook: CatalogHookMetadata): string | null {
  if (hook.handlerType === "command") return hook.command;
  if (hook.handlerType !== "mcpTool") return null;
  return `${hook.server}/${hook.tool}`;
}

export function hookItemsFromCatalogHooks(hooks: readonly CatalogHookMetadata[]): HookItem[] {
  return hooks.map((hook) => hookItemFromCatalogHook(hook));
}

export function appServerHookOperationFromHookItem(hook: HookItem): AppServerHookOperation {
  return {
    key: hook.key,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus,
  };
}

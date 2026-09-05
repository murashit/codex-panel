import type { HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";

export interface CatalogModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: readonly { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string | null;
  inputModalities: readonly string[];
  serviceTiers: readonly { id: string; name: string }[];
  defaultServiceTier: string | null;
  isDefault: boolean;
  [key: string]: unknown;
}

export interface CatalogSkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: { shortDescription?: string } | null;
  path: string;
  enabled: boolean;
  [key: string]: unknown;
}

interface CatalogHookCommon {
  key: string;
  eventName: string;
  matcher: string | null;
  statusMessage: string | null;
  sourcePath: string;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: AppServerHookTrustStatus;
  [key: string]: unknown;
}

export type CatalogHookMetadata = CatalogHookCommon &
  (
    | { handlerType: "command"; command: string }
    | { handlerType: "mcpTool"; server: string; tool: string }
    | { handlerType: "prompt" | "agent" }
  );

type AppServerHookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export interface AppServerHookOperation {
  key: string;
  currentHash: string;
  trustStatus: AppServerHookTrustStatus;
}

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

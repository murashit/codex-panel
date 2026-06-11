import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Model } from "../generated/app-server/v2/Model";
import type { SkillMetadata as AppServerSkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { AppServerHookOperation } from "./client";
import type { HookItem, ModelMetadata, SkillMetadata } from "../domain/catalog/metadata";

export type { HookMetadata as AppServerHookMetadata, Model as AppServerModel, AppServerSkillMetadata };

function modelMetadataFromAppServerModel(model: Model): ModelMetadata {
  return {
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    description: model.description,
    hidden: model.hidden,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
    defaultReasoningEffort: model.defaultReasoningEffort,
    inputModalities: [...model.inputModalities],
    additionalSpeedTiers: [...model.additionalSpeedTiers],
    serviceTiers: model.serviceTiers.map((tier) => ({ id: tier.id, name: tier.name })),
    defaultServiceTier: model.defaultServiceTier,
    isDefault: model.isDefault,
  };
}

export function modelMetadataFromAppServerModels(models: readonly Model[]): ModelMetadata[] {
  return models.map((model) => modelMetadataFromAppServerModel(model));
}

function skillMetadataFromAppServerSkill(skill: AppServerSkillMetadata): SkillMetadata {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.interface?.shortDescription !== undefined ? { interfaceShortDescription: skill.interface.shortDescription } : {}),
    path: skill.path,
    enabled: skill.enabled,
  };
}

export function skillMetadataFromAppServerSkills(skills: readonly AppServerSkillMetadata[]): SkillMetadata[] {
  return skills.map((skill) => skillMetadataFromAppServerSkill(skill));
}

function hookItemFromAppServerHook(hook: HookMetadata): HookItem {
  return {
    key: hook.key,
    eventName: hook.eventName,
    matcher: hook.matcher,
    command: hook.command,
    statusMessage: hook.statusMessage,
    sourcePath: hook.sourcePath,
    enabled: hook.enabled,
    isManaged: hook.isManaged,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus,
  };
}

export function hookItemsFromAppServerHooks(hooks: readonly HookMetadata[]): HookItem[] {
  return hooks.map((hook) => hookItemFromAppServerHook(hook));
}

export function appServerHookOperationFromHookItem(hook: HookItem): AppServerHookOperation {
  return {
    key: hook.key,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus,
  };
}

import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Model } from "../generated/app-server/v2/Model";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { AppServerHookOperation } from "./client";
import type { PanelHookItem, PanelModelOption, PanelSkillOption } from "../domain/catalog/model";

function panelModelOptionFromAppServerModel(model: Model): PanelModelOption {
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

export function panelModelOptionsFromAppServerModels(models: readonly Model[]): PanelModelOption[] {
  return models.map((model) => panelModelOptionFromAppServerModel(model));
}

function panelSkillOptionFromAppServerSkill(skill: SkillMetadata): PanelSkillOption {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.interface?.shortDescription !== undefined ? { interfaceShortDescription: skill.interface.shortDescription } : {}),
    path: skill.path,
    enabled: skill.enabled,
  };
}

export function panelSkillOptionsFromAppServerSkills(skills: readonly SkillMetadata[]): PanelSkillOption[] {
  return skills.map((skill) => panelSkillOptionFromAppServerSkill(skill));
}

function panelHookItemFromAppServerHook(hook: HookMetadata): PanelHookItem {
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

export function panelHookItemsFromAppServerHooks(hooks: readonly HookMetadata[]): PanelHookItem[] {
  return hooks.map((hook) => panelHookItemFromAppServerHook(hook));
}

export function appServerHookOperationFromPanelHookItem(hook: PanelHookItem): AppServerHookOperation {
  return {
    key: hook.key,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus,
  };
}

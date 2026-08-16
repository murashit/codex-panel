import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { normalizeReasoningEffort } from "../../../../domain/catalog/metadata";
import { modelOverrideMessage, permissionProfileOverrideMessage, reasoningEffortOverrideMessage } from "../../domain/runtime/labels";
import { slashCommandDefinition, slashCommandHelpSections } from "./catalog";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "./execution-contracts";

const DEFAULT_RUNTIME_SETTING_ALIASES = new Set(["default", "reset", "clear", "off"]);

export type RuntimeSlashCommandName =
  | "fast"
  | "auto-review"
  | "plan"
  | "status"
  | "permissions"
  | "doctor"
  | "tools"
  | "model"
  | "reasoning"
  | "help";

type RuntimeSlashCommandContext = Pick<
  SlashCommandExecutionContext,
  | "submission"
  | "runtimeSettings"
  | "addSystemMessage"
  | "addStructuredSystemMessage"
  | "statusDetails"
  | "permissionDetails"
  | "connectionDiagnosticDetails"
  | "toolInventoryDetails"
  | "modelStatusDetails"
  | "effortStatusDetails"
>;

export async function executeRuntimeSlashCommand(
  command: RuntimeSlashCommandName,
  args: string,
  context: RuntimeSlashCommandContext,
): Promise<SlashCommandExecutionResult | undefined> {
  switch (command) {
    case "fast":
      context.submission.markAdopted();
      await context.runtimeSettings.toggleFastMode();
      return;
    case "auto-review":
      context.submission.markAdopted();
      await context.runtimeSettings.toggleAutoReview();
      return;
    case "plan":
      context.submission.markAdopted();
      await context.runtimeSettings.toggleCollaborationMode();
      return args ? { sendText: args } : undefined;
    case "status":
      context.addStructuredSystemMessage("Thread status", context.statusDetails());
      return;
    case "permissions": {
      const requested = parsePermissionProfileOverride(args);
      if (requested === undefined) {
        context.addStructuredSystemMessage("Permissions & Approvals", context.permissionDetails());
        return;
      }
      context.submission.markAdopted();
      if ((await applyPermissionProfileOverride(context, requested)) === false) return;
      context.addSystemMessage(permissionProfileOverrideMessage(requested));
      return;
    }
    case "doctor":
      context.addStructuredSystemMessage("Connection diagnostics", context.connectionDiagnosticDetails());
      return;
    case "tools":
      context.addStructuredSystemMessage("Codex capabilities", await context.toolInventoryDetails());
      return;
    case "model": {
      const requested = parseModelOverride(args);
      if (requested === undefined) {
        context.addStructuredSystemMessage("Model settings", context.modelStatusDetails());
        return;
      }
      context.submission.markAdopted();
      if ((await applyModelOverride(context, requested)) === false) return;
      context.addSystemMessage(modelOverrideMessage(requested));
      return;
    }
    case "reasoning": {
      const requested = parseReasoningEffortOverride(args);
      if (requested === undefined) {
        if (args) {
          context.addSystemMessage(`Unsupported reasoning level: ${args}. Usage: ${slashCommandDefinition(command).usage}`);
          return;
        }
        context.addStructuredSystemMessage("Reasoning effort", context.effortStatusDetails());
        return;
      }
      context.submission.markAdopted();
      if ((await applyReasoningEffortOverride(context, requested)) === false) return;
      context.addSystemMessage(reasoningEffortOverrideMessage(requested));
      return;
    }
    case "help":
      context.addStructuredSystemMessage("Available slash commands", slashCommandHelpSections());
      return;
  }
  const _exhaustive: never = command;
  return _exhaustive;
}

function applyModelOverride(
  context: RuntimeSlashCommandContext,
  requested: string | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null ? context.runtimeSettings.resetModelToConfig() : context.runtimeSettings.requestModel(requested);
}

function applyPermissionProfileOverride(
  context: RuntimeSlashCommandContext,
  requested: string | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null
    ? context.runtimeSettings.resetPermissionProfileToConfig()
    : context.runtimeSettings.requestPermissionProfile(requested);
}

function applyReasoningEffortOverride(
  context: RuntimeSlashCommandContext,
  requested: ReasoningEffort | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null
    ? context.runtimeSettings.resetReasoningEffortToConfig()
    : context.runtimeSettings.requestReasoningEffort(requested);
}

function parseModelOverride(args: string): string | null | undefined {
  const model = args.trim();
  if (!model) return undefined;
  return DEFAULT_RUNTIME_SETTING_ALIASES.has(model.toLowerCase()) ? null : model;
}

function parsePermissionProfileOverride(args: string): string | null | undefined {
  const profile = args.trim();
  if (!profile) return undefined;
  return profile.toLowerCase() === "default" ? null : profile;
}

function parseReasoningEffortOverride(args: string): ReasoningEffort | null | undefined {
  const effort = args.trim();
  if (!effort) return undefined;
  if (DEFAULT_RUNTIME_SETTING_ALIASES.has(effort.toLowerCase())) return null;
  return normalizeReasoningEffort(effort) ?? undefined;
}

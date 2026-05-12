import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";

export function nextCollaborationMode(mode: ModeKind): ModeKind {
  return mode === "plan" ? "default" : "plan";
}

export function collaborationModeLabel(mode: ModeKind): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function collaborationModeToggleMessage(mode: ModeKind): string {
  return mode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.";
}

export function planCollaborationMode(model: string, reasoningEffort: ReasoningEffort | null): CollaborationMode {
  return {
    mode: "plan",
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}

export function defaultCollaborationMode(model: string, reasoningEffort: ReasoningEffort | null): CollaborationMode {
  return {
    mode: "default",
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}

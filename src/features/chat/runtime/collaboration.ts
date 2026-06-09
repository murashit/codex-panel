export type CollaborationMode = "default" | "plan";

export function nextCollaborationMode(mode: CollaborationMode): CollaborationMode {
  return mode === "plan" ? "default" : "plan";
}

export function collaborationModeLabel(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function collaborationModeToggleMessage(mode: CollaborationMode): string {
  return mode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.";
}

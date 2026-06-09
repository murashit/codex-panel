export type PanelCollaborationMode = "default" | "plan";

export function nextCollaborationMode(mode: PanelCollaborationMode): PanelCollaborationMode {
  return mode === "plan" ? "default" : "plan";
}

export function collaborationModeLabel(mode: PanelCollaborationMode): string {
  return mode === "plan" ? "Plan" : "Default";
}

export function collaborationModeToggleMessage(mode: PanelCollaborationMode): string {
  return mode === "plan" ? "Plan mode on for subsequent turns." : "Plan mode off for subsequent turns.";
}

import type { ModeKind } from "../../../../domain/runtime/thread-settings";

export type CollaborationModeSelection = ModeKind;
export type ActiveCollaborationMode = CollaborationModeSelection | null;

// Pending runtime intents are panel-side user requests, not app-server protocol values.
// They are projected for display and reduced into panel-owned runtime settings patches before app-server protocol adaptation.
export type PendingRuntimeIntent<T> =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly value: T }
  | { readonly kind: "resetToConfig" };
export type RequestedFastMode = "enabled" | "disabled";

export function unchangedRuntimeIntent<T>(): PendingRuntimeIntent<T> {
  return { kind: "unchanged" };
}

export function setRuntimeIntentValue<T>(value: T): PendingRuntimeIntent<T> {
  return { kind: "set", value };
}

export function resetRuntimeIntentToConfig<T>(): PendingRuntimeIntent<T> {
  return { kind: "resetToConfig" };
}

export function nextCollaborationMode(mode: CollaborationModeSelection): CollaborationModeSelection {
  return mode === "plan" ? "default" : "plan";
}

export function effectiveCollaborationMode(mode: ActiveCollaborationMode): CollaborationModeSelection {
  return mode ?? "default";
}

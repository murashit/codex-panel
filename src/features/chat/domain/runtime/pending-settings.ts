import type { ModeKind } from "../../../../domain/runtime/thread-settings";

export type CollaborationModeSelection = ModeKind;
export type ActiveCollaborationMode = CollaborationModeSelection | null;
export type PendingRuntimeSetting<T> =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly value: T }
  | { readonly kind: "resetToConfig" };
export type RequestedFastMode = "enabled" | "disabled";

export function unchangedRuntimeSetting<T>(): PendingRuntimeSetting<T> {
  return { kind: "unchanged" };
}

export function setPendingRuntimeSetting<T>(value: T): PendingRuntimeSetting<T> {
  return { kind: "set", value };
}

export function resetRuntimeSettingToConfig<T>(): PendingRuntimeSetting<T> {
  return { kind: "resetToConfig" };
}

export function nextCollaborationMode(mode: CollaborationModeSelection): CollaborationModeSelection {
  return mode === "plan" ? "default" : "plan";
}

export function effectiveCollaborationMode(mode: ActiveCollaborationMode): CollaborationModeSelection {
  return mode ?? "default";
}

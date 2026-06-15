export type CollaborationMode = "default" | "plan";
export type ActiveCollaborationMode = CollaborationMode | null;
export type PendingRuntimeSetting<T> =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly value: T }
  | { readonly kind: "resetToConfig" };
export type RequestedServiceTier = "fast" | "off";

export function unchangedRuntimeSetting<T>(): PendingRuntimeSetting<T> {
  return { kind: "unchanged" };
}

export function setPendingRuntimeSetting<T>(value: T): PendingRuntimeSetting<T> {
  return { kind: "set", value };
}

export function resetRuntimeSettingToConfig<T>(): PendingRuntimeSetting<T> {
  return { kind: "resetToConfig" };
}

export function nextCollaborationMode(mode: CollaborationMode): CollaborationMode {
  return mode === "plan" ? "default" : "plan";
}

export function effectiveCollaborationMode(mode: ActiveCollaborationMode): CollaborationMode {
  return mode ?? "default";
}

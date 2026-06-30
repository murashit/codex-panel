export type SettingsDynamicSectionLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string }
  | { kind: "loaded"; status: string }
  | { kind: "failed"; status: string };

export function createSettingsDynamicSectionLifecycle(): SettingsDynamicSectionLifecycleState {
  return { kind: "idle", status: "" };
}

export function settingsDynamicSectionLoading(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "loading", status };
}

export function settingsDynamicSectionLoaded(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "loaded", status };
}

export function settingsDynamicSectionFailed(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "failed", status };
}

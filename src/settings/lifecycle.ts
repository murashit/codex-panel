export type SettingsDataRefreshLifecycleState =
  | { kind: "idle" }
  | { kind: "loading"; operationId: number }
  | { kind: "completed"; failedCount: number; operationId: number };

export type SettingsDataRefreshLifecycleEvent =
  | { type: "started"; operationId: number }
  | { type: "completed"; failedCount: number; operationId: number };

export type SettingsDynamicSectionLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string; operationId: number }
  | { kind: "loaded"; status: string; operationId: number }
  | { kind: "failed"; status: string; operationId: number };

export type SettingsDynamicSectionLifecycleEvent =
  | { type: "started"; status: string; operationId: number }
  | { type: "loaded"; status: string; operationId: number }
  | { type: "failed"; status: string; operationId: number }
  | { type: "reset" };

export function transitionSettingsDataRefreshLifecycle(
  state: SettingsDataRefreshLifecycleState,
  event: SettingsDataRefreshLifecycleEvent,
): SettingsDataRefreshLifecycleState {
  switch (event.type) {
    case "started":
      if (isStaleSettingsDataRefreshEvent(state, event.operationId)) return state;
      return { kind: "loading", operationId: event.operationId };
    case "completed":
      if (isStaleSettingsDataRefreshEvent(state, event.operationId)) return state;
      return { kind: "completed", failedCount: event.failedCount, operationId: event.operationId };
  }
}

export function createSettingsDynamicSectionLifecycle(): SettingsDynamicSectionLifecycleState {
  return { kind: "idle", status: "" };
}

export function transitionSettingsDynamicSectionLifecycle(
  state: SettingsDynamicSectionLifecycleState,
  event: SettingsDynamicSectionLifecycleEvent,
): SettingsDynamicSectionLifecycleState {
  switch (event.type) {
    case "started":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationId)) return state;
      return { kind: "loading", status: event.status, operationId: event.operationId };
    case "loaded":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationId)) return state;
      return { kind: "loaded", status: event.status, operationId: event.operationId };
    case "failed":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationId)) return state;
      return { kind: "failed", status: event.status, operationId: event.operationId };
    case "reset":
      return createSettingsDynamicSectionLifecycle();
  }
}

function isStaleSettingsDynamicSectionEvent(state: SettingsDynamicSectionLifecycleState, operationId: number): boolean {
  return "operationId" in state && state.operationId > operationId;
}

function isStaleSettingsDataRefreshEvent(state: SettingsDataRefreshLifecycleState, operationId: number): boolean {
  return "operationId" in state && state.operationId > operationId;
}

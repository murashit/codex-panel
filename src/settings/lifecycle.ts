export type SettingsDynamicSectionLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string; operationToken: number }
  | { kind: "loaded"; status: string; operationToken: number }
  | { kind: "failed"; status: string; operationToken: number };

export type SettingsDynamicSectionLifecycleEvent =
  | { type: "started"; status: string; operationToken: number }
  | { type: "loaded"; status: string; operationToken: number }
  | { type: "failed"; status: string; operationToken: number }
  | { type: "reset" };

export function createSettingsDynamicSectionLifecycle(): SettingsDynamicSectionLifecycleState {
  return { kind: "idle", status: "" };
}

export function transitionSettingsDynamicSectionLifecycle(
  state: SettingsDynamicSectionLifecycleState,
  event: SettingsDynamicSectionLifecycleEvent,
): SettingsDynamicSectionLifecycleState {
  switch (event.type) {
    case "started":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationToken)) return state;
      return { kind: "loading", status: event.status, operationToken: event.operationToken };
    case "loaded":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationToken)) return state;
      return { kind: "loaded", status: event.status, operationToken: event.operationToken };
    case "failed":
      if (isStaleSettingsDynamicSectionEvent(state, event.operationToken)) return state;
      return { kind: "failed", status: event.status, operationToken: event.operationToken };
    case "reset":
      return createSettingsDynamicSectionLifecycle();
  }
}

function isStaleSettingsDynamicSectionEvent(state: SettingsDynamicSectionLifecycleState, operationToken: number): boolean {
  return "operationToken" in state && state.operationToken > operationToken;
}

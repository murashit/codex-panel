import { cloneRuntimeConfigSnapshot, emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../../app-server/runtime-config";

export type RuntimeConfigProjection = RuntimeConfigSnapshot;

export function runtimeConfigOrDefault(runtimeConfig: RuntimeConfigSnapshot | null): RuntimeConfigProjection {
  return runtimeConfig ? cloneRuntimeConfigSnapshot(runtimeConfig) : emptyRuntimeConfigSnapshot();
}

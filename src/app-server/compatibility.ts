import type { InitializeResponse } from "../generated/app-server/InitializeResponse";

export type CapabilityProbeState = "unknown" | "ok" | "failed";

export interface AppServerCompatibility {
  modelList: CapabilityProbeState;
  modelListError: string | null;
}

export function createAppServerCompatibility(): AppServerCompatibility {
  return {
    modelList: "unknown",
    modelListError: null,
  };
}

export function appServerIdentity(initializeResponse: InitializeResponse | null): string {
  return initializeResponse?.userAgent || "(not connected)";
}

export function appServerPlatform(initializeResponse: InitializeResponse | null): string {
  if (!initializeResponse) return "(not connected)";
  const family = initializeResponse.platformFamily || "unknown";
  const os = initializeResponse.platformOs || "unknown";
  return `${os}/${family}`;
}

export function compatibilitySummary(compatibility: AppServerCompatibility): string {
  const modelList = compatibility.modelList === "failed" ? `model/list failed` : `model/list ${compatibility.modelList}`;
  return `${modelList}; Plan mode uses experimental collaborationMode override`;
}

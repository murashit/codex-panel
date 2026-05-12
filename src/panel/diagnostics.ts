import { appServerIdentity, appServerPlatform, compatibilitySummary } from "../app-server/compatibility";
import { CLIENT_VERSION } from "../constants";
import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { AppServerCompatibility } from "../app-server/compatibility";

export interface DiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface ConnectionDiagnosticsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: InitializeResponse | null;
  activeThreadCliVersion: string | null;
  compatibility: AppServerCompatibility;
}

export function connectionDiagnosticRows(input: ConnectionDiagnosticsInput): DiagnosticRow[] {
  const rows: DiagnosticRow[] = [
    { label: "connection", value: input.connected ? "connected" : "offline" },
    { label: "configured command", value: input.configuredCommand },
    { label: "running app-server", value: appServerIdentity(input.initializeResponse) },
    { label: "panel client", value: CLIENT_VERSION },
    { label: "platform", value: appServerPlatform(input.initializeResponse) },
    { label: "codexHome", value: input.initializeResponse?.codexHome ?? "(not connected)" },
    { label: "active thread CLI", value: input.activeThreadCliVersion ?? "(none)" },
    {
      label: "compatibility",
      value: compatibilitySummary(input.compatibility),
      level: input.compatibility.modelList === "failed" ? "error" : "normal",
    },
  ];
  if (input.compatibility.modelListError) {
    rows.push({ label: "model/list error", value: input.compatibility.modelListError, level: "error" });
  }
  return rows;
}

export function connectionDiagnosticLines(rows: DiagnosticRow[]): string[] {
  return ["Connection diagnostics", ...rows.map((row) => `${row.label}: ${row.value}`)];
}

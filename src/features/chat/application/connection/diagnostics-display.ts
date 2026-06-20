import { serverIdentity, serverPlatform, type DiagnosticProbeMethod } from "../../../../domain/server/diagnostics";
import { CLIENT_VERSION } from "../../../../constants";
import type { ChatState } from "../state/root-reducer";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { Diagnostics, DiagnosticProbeResult } from "../../../../domain/server/diagnostics";

const RUNTIME_CHECK_PROBE_METHODS: readonly DiagnosticProbeMethod[] = ["model/list", "account/rateLimits/read"];

export interface DiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface DiagnosticSection {
  title: string;
  rows: DiagnosticRow[];
}

export interface ConnectionDiagnosticsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: ServerInitialization | null;
  diagnostics: Diagnostics;
}

export interface ConnectionDiagnosticsModelInput {
  state: Pick<ChatState, "connection">;
  connected: boolean;
  configuredCommand: string;
}

export function connectionDiagnosticSectionsModel(input: ConnectionDiagnosticsModelInput): DiagnosticSection[] {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    diagnostics: input.state.connection.serverDiagnostics,
  });
}

export function connectionDiagnosticSections(input: ConnectionDiagnosticsInput): DiagnosticSection[] {
  return [
    {
      title: "Process",
      rows: [
        { label: "connection", value: input.connected ? "connected" : "offline" },
        { label: "configured command", value: input.configuredCommand },
        { label: "Codex App Server", value: serverIdentity(input.initializeResponse) },
        { label: "panel client", value: CLIENT_VERSION },
        { label: "platform", value: serverPlatform(input.initializeResponse) },
        { label: "Codex home", value: input.initializeResponse?.codexHome ?? "(not connected)" },
      ],
    },
    {
      title: "Runtime Checks",
      rows: RUNTIME_CHECK_PROBE_METHODS.map((method) => diagnosticProbeRow(input.diagnostics.probes[method])),
    },
  ];
}

function diagnosticProbeRow(probe: DiagnosticProbeResult): DiagnosticRow {
  const detail = probe.message ? ` - ${probe.message}` : probe.summary ? ` (${probe.summary})` : "";
  return {
    label: probe.method,
    value: `${probe.status}${detail}`,
    level: diagnosticProbeLevel(probe.status),
  };
}

function diagnosticProbeLevel(status: DiagnosticProbeResult["status"]): NonNullable<DiagnosticRow["level"]> {
  if (status === "failed") return "error";
  if (status === "unknown") return "warning";
  return "normal";
}

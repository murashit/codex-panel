import { CLIENT_VERSION } from "../../../../constants";
import type { DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import { type DiagnosticProbeMethod, serverIdentity, serverPlatform } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ChatState } from "../state/root-reducer";

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

interface ConnectionDiagnosticsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: ServerInitialization | null;
  diagnostics: Diagnostics;
}

export interface ConnectionDiagnosticSectionsInput {
  state: Pick<ChatState, "connection">;
  connected: boolean;
  configuredCommand: string;
}

export function connectionDiagnosticSectionsFromState(input: ConnectionDiagnosticSectionsInput): DiagnosticSection[] {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    diagnostics: input.state.connection.serverDiagnostics,
  });
}

function connectionDiagnosticSections(input: ConnectionDiagnosticsInput): DiagnosticSection[] {
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
    level: probe.status === "failed" ? "error" : probe.status === "unknown" ? "warning" : "normal",
  };
}

import { CLIENT_VERSION } from "../../../../constants";
import type { DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import { type DiagnosticProbeMethod, serverIdentity, serverPlatform } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";

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

export interface AppServerDiagnosticSectionsInput {
  connected: boolean;
  configuredCommand: string;
  initializeResponse: ServerInitialization | null;
  diagnostics: Diagnostics;
}

export function appServerDiagnosticSections(input: AppServerDiagnosticSectionsInput): DiagnosticSection[] {
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

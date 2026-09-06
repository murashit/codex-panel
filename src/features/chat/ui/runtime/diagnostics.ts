import { CLIENT_VERSION } from "../../../../constants";
import type { DiagnosticProbeId, DiagnosticProbeResult, Diagnostics } from "../../../../domain/server/diagnostics";
import { diagnosticProbeLabel, serverIdentity, serverPlatform } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ToolbarStatusRow as DiagnosticRow, ToolbarStatusSection as DiagnosticSection } from "../toolbar/model";

const RUNTIME_CHECK_PROBE_IDS: readonly DiagnosticProbeId[] = ["models", "rateLimits"];

interface AppServerDiagnosticSectionsInput {
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
      rows: RUNTIME_CHECK_PROBE_IDS.map((id) => diagnosticProbeRow(input.diagnostics.probes[id])),
    },
  ];
}

function diagnosticProbeRow(probe: DiagnosticProbeResult): DiagnosticRow {
  const detail = probe.message ? ` - ${probe.message}` : probe.summary ? ` (${probe.summary})` : "";
  return {
    label: diagnosticProbeLabel(probe.id),
    value: `${probe.status}${detail}`,
    level: probe.status === "failed" ? "error" : probe.status === "unknown" ? "warning" : "normal",
  };
}

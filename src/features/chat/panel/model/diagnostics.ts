import { connectionDiagnosticSections } from "../../diagnostics";
import type { ConnectionDiagnosticsModelInput } from "./types";

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    activeThreadCreationCliVersion: input.state.activeThread.creationCliVersion,
    diagnostics: input.state.connection.appServerDiagnostics,
  });
}

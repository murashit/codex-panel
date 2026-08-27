import { cloneServerDiagnostics, upsertMcpServerDiagnostic } from "../../../../domain/server/diagnostics";
import {
  type McpServerAuthenticationIssue,
  type McpServerStartupStatus,
  mcpConnectionStatusFromStartupStatus,
} from "../../../../domain/server/mcp-status";
import type { ChatStateStore } from "../state/store";

export type AppServerResourceFact =
  | { type: "skills-changed" }
  | { type: "rate-limits-updated" }
  | {
      type: "mcp-startup-status-updated";
      name: string;
      status: McpServerStartupStatus;
      message: string | null;
      authenticationIssue: McpServerAuthenticationIssue | null;
    };

export interface ServerResourceFactHost {
  stateStore: ChatStateStore;
  refreshSkills: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
}

export async function handleAppServerResourceFact(host: ServerResourceFactHost, fact: AppServerResourceFact): Promise<void> {
  switch (fact.type) {
    case "skills-changed":
      await host.refreshSkills();
      return;
    case "rate-limits-updated":
      await host.refreshRateLimits();
      return;
    case "mcp-startup-status-updated":
      if (fact.name.length > 0) applyMcpStartupStatusEvent(host, fact.name, fact.status, fact.message, fact.authenticationIssue);
      return;
  }
}

function applyMcpStartupStatusEvent(
  host: ServerResourceFactHost,
  name: string,
  startupStatus: McpServerStartupStatus,
  message: string | null,
  authenticationIssue: McpServerAuthenticationIssue | null,
): void {
  const diagnostics = upsertMcpServerDiagnostic(cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics), {
    name,
    connectionStatus: mcpConnectionStatusFromStartupStatus(startupStatus),
    authStatus: null,
    toolCount: null,
    message,
    authenticationIssue,
  });
  host.stateStore.dispatch({
    type: "connection/diagnostics-applied",
    serverDiagnostics: diagnostics,
  });
}

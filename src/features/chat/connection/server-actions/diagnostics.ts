import type { AppServerClient } from "../../../../app-server/client";
import {
  diagnosticProbeError,
  diagnosticProbeOk,
  mcpServerStatusSummariesFromStatuses,
  upsertMcpServerStatusDiagnostics,
  upsertMcpServerDiagnostic,
  type Diagnostics,
  type DiagnosticProbeMethod,
  type McpServerStartupStatus,
  type McpServerStatusSummary,
} from "../../../../app-server/diagnostics";
import type { SharedAppServerMetadata } from "../../../../app-server/shared-cache-state";
import { mcpStatusLines as buildMcpStatusLines } from "../../display/status/diagnostics";
import { cloneAppServerDiagnostics, type ChatServerActionHost } from "./host";

interface RefreshDiagnosticProbesOptions {
  cachedAppServerMetadata?: boolean;
}

interface DiagnosticProbeSnapshot {
  method: DiagnosticProbeMethod;
  probe: Diagnostics["probes"][DiagnosticProbeMethod];
  mcpServerStatuses?: readonly McpServerStatusSummary[];
}

export interface ChatServerDiagnosticsActionsHost extends ChatServerActionHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  serverMetadataSnapshot: () => SharedAppServerMetadata;
}

export interface ChatServerDiagnosticsActions {
  refreshDiagnosticProbes: (options?: RefreshDiagnosticProbesOptions) => Promise<void>;
  refreshPublishedDiagnosticProbes: (options?: RefreshDiagnosticProbesOptions) => Promise<void>;
  mcpStatusLines: () => Promise<string[]>;
  recordMcpStartupStatus: (name: string, startupStatus: McpServerStartupStatus, message: string | null) => void;
}

export function createChatServerDiagnosticsActions(host: ChatServerDiagnosticsActionsHost): ChatServerDiagnosticsActions {
  return {
    refreshDiagnosticProbes: async (options) => {
      await refreshDiagnosticProbes(host, options);
    },
    refreshPublishedDiagnosticProbes: (options) => refreshPublishedDiagnosticProbes(host, options),
    mcpStatusLines: () => mcpStatusLines(host),
    recordMcpStartupStatus: (name, startupStatus, message) => {
      recordMcpStartupStatus(host, name, startupStatus, message);
    },
  };
}

async function refreshDiagnosticProbes(
  host: ChatServerDiagnosticsActionsHost,
  options: RefreshDiagnosticProbesOptions = {},
): Promise<boolean> {
  const client = host.currentClient();
  if (!client) return false;

  const probes: Promise<DiagnosticProbeSnapshot>[] = [];
  if (!options.cachedAppServerMetadata) {
    probes.push(
      probeDiagnostic(
        "model/list",
        () => client.listModels(false),
        (response) => `${String(response.data.length)} models`,
      ),
      probeDiagnostic(
        "skills/list",
        () => client.listSkills(host.vaultPath),
        (response) => {
          const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
          return `${String(count)} skills`;
        },
      ),
      probeDiagnostic(
        "account/rateLimits/read",
        () => client.readAccountRateLimits(),
        (response) => (response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available"),
      ),
    );
  }

  probes.push(
    probeDiagnostic(
      "hooks/list",
      () => client.listHooks(host.vaultPath),
      (response) => {
        const count = response.data.reduce((total, entry) => total + entry.hooks.length, 0);
        return `${String(count)} hooks`;
      },
    ),
    probeDiagnostic(
      "mcpServerStatus/list",
      () => client.listMcpServerStatus(mcpServerStatusParams(host.stateStore.getState().activeThread.id)),
      (response) => {
        const summaries = mcpServerStatusSummariesFromStatuses(response.data);
        const issueCount = summaries.filter((server) => server.authStatus === "notLoggedIn").length;
        return issueCount > 0
          ? `${String(summaries.length)} servers, ${String(issueCount)} auth issues`
          : `${String(summaries.length)} servers`;
      },
      (response) => mcpServerStatusSummariesFromStatuses(response.data),
    ),
    probeDiagnostic(
      "collaborationMode/list",
      () => client.listCollaborationModes(),
      (response) => `${String(response.data.length)} modes`,
    ),
    probeDiagnostic(
      "modelProvider/capabilities/read",
      () => client.readModelProviderCapabilities(),
      (response) =>
        [
          response.namespaceTools ? "namespace tools" : null,
          response.imageGeneration ? "image generation" : null,
          response.webSearch ? "web search" : null,
        ]
          .filter(Boolean)
          .join(", ") || "no optional capabilities",
    ),
  );

  const results = await Promise.all(probes);
  if (host.currentClient() !== client) return false;

  let diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  for (const result of results) {
    diagnostics.probes[result.method] = result.probe;
    if (result.mcpServerStatuses) diagnostics = upsertMcpServerStatusDiagnostics(diagnostics, result.mcpServerStatuses);
  }
  host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  return true;
}

async function refreshPublishedDiagnosticProbes(
  host: ChatServerDiagnosticsActionsHost,
  options: RefreshDiagnosticProbesOptions = {},
): Promise<void> {
  if (!(await refreshDiagnosticProbes(host, options))) return;
  host.publishAppServerMetadata(host.serverMetadataSnapshot());
}

async function mcpStatusLines(host: ChatServerDiagnosticsActionsHost): Promise<string[]> {
  const client = host.currentClient();
  if (!client) return ["MCP servers", "Codex app-server is not connected."];

  try {
    const state = host.stateStore.getState();
    const response = await client.listMcpServerStatus(mcpServerStatusParams(state.activeThread.id));
    return buildMcpStatusLines(
      mcpServerStatusSummariesFromStatuses(response.data),
      state.connection.appServerDiagnostics.mcpServers,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ["MCP servers", `Could not load MCP servers: ${message}`];
  }
}

function recordMcpStartupStatus(
  host: ChatServerDiagnosticsActionsHost,
  name: string,
  startupStatus: McpServerStartupStatus,
  message: string | null,
): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    appServerDiagnostics: upsertMcpServerDiagnostic(host.stateStore.getState().connection.appServerDiagnostics, {
      name,
      startupStatus,
      authStatus: null,
      toolCount: null,
      message,
    }),
  });
}

async function probeDiagnostic<T>(
  method: DiagnosticProbeMethod,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
  mcpServerStatuses?: (response: T) => readonly McpServerStatusSummary[],
): Promise<DiagnosticProbeSnapshot> {
  try {
    const response = await request();
    const statuses = mcpServerStatuses?.(response);
    return {
      method,
      probe: diagnosticProbeOk(method, summarize(response)),
      ...(statuses ? { mcpServerStatuses: statuses } : {}),
    };
  } catch (error) {
    return { method, probe: diagnosticProbeError(method, error) };
  }
}

function mcpServerStatusParams(threadId: string | null): Parameters<AppServerClient["listMcpServerStatus"]>[0] {
  return {
    detail: "toolsAndAuthOnly",
    limit: 100,
    ...(threadId ? { threadId } : {}),
  };
}

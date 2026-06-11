import type { AppServerClient } from "../../../../app-server/client";
import {
  diagnosticProbeError,
  diagnosticProbeOk,
  mcpServerStatusSummariesFromAppServerStatuses,
  upsertMcpServerStatusDiagnostics,
  upsertMcpServerDiagnostic,
  type DiagnosticProbeMethod,
  type McpServerStartupStatus,
  type McpServerStatusSummary,
} from "../../../../app-server/diagnostics";
import type { SharedAppServerMetadata } from "../../../../app-server/shared-cache-state";
import { mcpStatusLines as buildMcpStatusLines } from "../../mcp-status";
import { cloneAppServerDiagnostics, type ChatServerActionHost } from "./shared";

interface RefreshDiagnosticProbesOptions {
  cachedAppServerMetadata?: boolean;
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
    refreshDiagnosticProbes: (options) => refreshDiagnosticProbes(host, options),
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
): Promise<void> {
  const client = host.currentClient();
  if (!client) return;

  const probes: Promise<void>[] = [];
  if (!options.cachedAppServerMetadata) {
    probes.push(
      probeDiagnostic(
        host,
        "model/list",
        () => client.listModels(false),
        (response) => `${String(response.data.length)} models`,
      ),
      probeDiagnostic(
        host,
        "skills/list",
        () => client.listSkills(host.vaultPath),
        (response) => {
          const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
          return `${String(count)} skills`;
        },
      ),
      probeDiagnostic(
        host,
        "account/rateLimits/read",
        () => client.readAccountRateLimits(),
        (response) => (response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available"),
      ),
    );
  }

  probes.push(
    probeDiagnostic(
      host,
      "hooks/list",
      () => client.listHooks(host.vaultPath),
      (response) => {
        const count = response.data.reduce((total, entry) => total + entry.hooks.length, 0);
        return `${String(count)} hooks`;
      },
    ),
    probeDiagnostic(
      host,
      "mcpServerStatus/list",
      () => client.listMcpServerStatus(mcpServerStatusParams(host.stateStore.getState().activeThread.id)),
      (response) => {
        const summaries = mcpServerStatusSummariesFromAppServerStatuses(response.data);
        recordMcpServerStatusDiagnostics(host, summaries);
        const issueCount = summaries.filter((server) => server.authStatus === "notLoggedIn").length;
        return issueCount > 0
          ? `${String(summaries.length)} servers, ${String(issueCount)} auth issues`
          : `${String(summaries.length)} servers`;
      },
    ),
    probeDiagnostic(
      host,
      "collaborationMode/list",
      () => client.listCollaborationModes(),
      (response) => `${String(response.data.length)} modes`,
    ),
    probeDiagnostic(
      host,
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

  await Promise.all(probes);
}

async function refreshPublishedDiagnosticProbes(
  host: ChatServerDiagnosticsActionsHost,
  options: RefreshDiagnosticProbesOptions = {},
): Promise<void> {
  await refreshDiagnosticProbes(host, options);
  host.publishAppServerMetadata(host.serverMetadataSnapshot());
}

async function mcpStatusLines(host: ChatServerDiagnosticsActionsHost): Promise<string[]> {
  const client = host.currentClient();
  if (!client) return ["MCP servers", "Codex app-server is not connected."];

  try {
    const state = host.stateStore.getState();
    const response = await client.listMcpServerStatus(mcpServerStatusParams(state.activeThread.id));
    return buildMcpStatusLines(
      mcpServerStatusSummariesFromAppServerStatuses(response.data),
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
  host: ChatServerDiagnosticsActionsHost,
  method: DiagnosticProbeMethod,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
): Promise<void> {
  try {
    const response = await request();
    const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes[method] = diagnosticProbeOk(method, summarize(response));
    host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  } catch (error) {
    const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes[method] = diagnosticProbeError(method, error);
    host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  }
}

function recordMcpServerStatusDiagnostics(host: ChatServerDiagnosticsActionsHost, servers: readonly McpServerStatusSummary[]): void {
  const diagnostics = upsertMcpServerStatusDiagnostics(host.stateStore.getState().connection.appServerDiagnostics, servers);
  host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
}

function mcpServerStatusParams(threadId: string | null): Parameters<AppServerClient["listMcpServerStatus"]>[0] {
  return {
    detail: "toolsAndAuthOnly",
    limit: 100,
    ...(threadId ? { threadId } : {}),
  };
}

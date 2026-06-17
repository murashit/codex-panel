import type { AppServerClient } from "../../../../app-server/connection/client";
import {
  cloneServerDiagnostics,
  diagnosticsWithProbe,
  diagnosticProbeError,
  diagnosticProbeOk,
  mcpServerStatusSummariesFromStatuses,
  upsertMcpServerStatusDiagnostics,
  upsertMcpServerDiagnostic,
  type Diagnostics,
  type DiagnosticProbeMethod,
  type McpServerStartupStatus,
  type McpServerStatusSummary,
} from "../../../../domain/server/diagnostics";
import { readRateLimitMetadataProbe } from "../../../../app-server/query/metadata-probes";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { mcpStatusLines as buildMcpStatusLines } from "../../application/connection/diagnostics-display";
import type { ChatServerActionHost } from "./host";

interface RefreshDiagnosticProbesOptions {
  appServerMetadataSnapshot?: boolean;
  forceResourceProbes?: boolean;
}

interface DiagnosticProbeSnapshot {
  method: DiagnosticProbeMethod;
  probe: Diagnostics["probes"][DiagnosticProbeMethod];
  mcpServerStatuses?: readonly McpServerStatusSummary[];
}

export interface ChatServerDiagnosticsActionsHost extends ChatServerActionHost {
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
}

export interface ChatServerDiagnosticsActions {
  refreshDiagnosticProbes: (options?: RefreshDiagnosticProbesOptions) => Promise<void>;
  mcpStatusLines: () => Promise<string[]>;
  recordMcpStartupStatus: (name: string, startupStatus: McpServerStartupStatus, message: string | null) => void;
}

export function createChatServerDiagnosticsActions(host: ChatServerDiagnosticsActionsHost): ChatServerDiagnosticsActions {
  return {
    refreshDiagnosticProbes: async (options) => {
      await refreshDiagnosticProbes(host, options);
    },
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
  if (options.forceResourceProbes === true && options.appServerMetadataSnapshot !== true) {
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
      readRateLimitDiagnosticProbe(client),
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

  let diagnostics = currentMetadataDiagnostics(host);
  for (const result of results) {
    diagnostics = diagnosticsWithProbe(diagnostics, result.probe);
    if (result.mcpServerStatuses) diagnostics = upsertMcpServerStatusDiagnostics(diagnostics, result.mcpServerStatuses);
  }
  host.updateAppServerMetadata((metadata) => (metadata ? { ...metadata, serverDiagnostics: diagnostics } : null));
  host.stateStore.dispatch({ type: "connection/metadata-applied", serverDiagnostics: diagnostics });
  return true;
}

async function readRateLimitDiagnosticProbe(client: AppServerClient): Promise<DiagnosticProbeSnapshot> {
  const result = await readRateLimitMetadataProbe(client);
  return { method: "account/rateLimits/read", probe: result.probe };
}

async function mcpStatusLines(host: ChatServerDiagnosticsActionsHost): Promise<string[]> {
  const client = host.currentClient();
  if (!client) return ["MCP servers", "Codex app-server is not connected."];

  try {
    const state = host.stateStore.getState();
    const response = await client.listMcpServerStatus(mcpServerStatusParams(state.activeThread.id));
    return buildMcpStatusLines(mcpServerStatusSummariesFromStatuses(response.data), state.connection.serverDiagnostics.mcpServers);
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
  const diagnostics = upsertMcpServerDiagnostic(currentMetadataDiagnostics(host), {
    name,
    startupStatus,
    authStatus: null,
    toolCount: null,
    message,
  });
  host.updateAppServerMetadata((metadata) => (metadata ? { ...metadata, serverDiagnostics: diagnostics } : null));
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    serverDiagnostics: diagnostics,
  });
}

function currentMetadataDiagnostics(host: ChatServerDiagnosticsActionsHost): SharedServerMetadata["serverDiagnostics"] {
  return (
    host.appServerMetadataSnapshot()?.serverDiagnostics ?? cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics)
  );
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
      probe: diagnosticProbeOk(method, summarize(response), Date.now()),
      ...(statuses ? { mcpServerStatuses: statuses } : {}),
    };
  } catch (error) {
    return { method, probe: diagnosticProbeError(method, error, Date.now()) };
  }
}

function mcpServerStatusParams(threadId: string | null): Parameters<AppServerClient["listMcpServerStatus"]>[0] {
  return {
    detail: "toolsAndAuthOnly",
    limit: 100,
    ...(threadId ? { threadId } : {}),
  };
}

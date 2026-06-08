import type { AppServerClient } from "../../../app-server/client";
import {
  capabilityProbeError,
  capabilityProbeOk,
  upsertMcpServerDiagnostic,
  type CapabilityProbeMethod,
} from "../../../app-server/compatibility";
import type { McpServerStatus } from "../../../generated/app-server/v2/McpServerStatus";
import type { SharedAppServerMetadata } from "../../../app-server/shared-cache-state";
import { mcpStatusLines as buildMcpStatusLines } from "../mcp-status";
import { cloneAppServerDiagnostics, type ChatAppServerBaseHost } from "./shared";

interface RefreshCapabilityDiagnosticsOptions {
  cachedAppServerMetadata?: boolean;
}

export interface ChatAppServerDiagnosticsActionsHost extends ChatAppServerBaseHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  appServerMetadataSnapshot: () => SharedAppServerMetadata;
}

export interface ChatAppServerDiagnosticsActions {
  refreshCapabilityDiagnostics: (options?: RefreshCapabilityDiagnosticsOptions) => Promise<void>;
  refreshPublishedCapabilityDiagnostics: (options?: RefreshCapabilityDiagnosticsOptions) => Promise<void>;
  mcpStatusLines: () => Promise<string[]>;
  recordMcpStartupStatus: (name: string, startupStatus: "starting" | "ready" | "failed" | "cancelled", message: string | null) => void;
}

export function createChatAppServerDiagnosticsActions(host: ChatAppServerDiagnosticsActionsHost): ChatAppServerDiagnosticsActions {
  return {
    refreshCapabilityDiagnostics: (options) => refreshCapabilityDiagnostics(host, options),
    refreshPublishedCapabilityDiagnostics: (options) => refreshPublishedCapabilityDiagnostics(host, options),
    mcpStatusLines: () => mcpStatusLines(host),
    recordMcpStartupStatus: (name, startupStatus, message) => {
      recordMcpStartupStatus(host, name, startupStatus, message);
    },
  };
}

async function refreshCapabilityDiagnostics(
  host: ChatAppServerDiagnosticsActionsHost,
  options: RefreshCapabilityDiagnosticsOptions = {},
): Promise<void> {
  const client = host.currentClient();
  if (!client) return;

  const probes: Promise<void>[] = [];
  if (!options.cachedAppServerMetadata) {
    probes.push(
      probeCapability(
        host,
        "model/list",
        () => client.listModels(false),
        (response) => `${String(response.data.length)} models`,
      ),
      probeCapability(
        host,
        "skills/list",
        () => client.listSkills(host.vaultPath),
        (response) => {
          const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
          return `${String(count)} skills`;
        },
      ),
      probeCapability(
        host,
        "account/rateLimits/read",
        () => client.readAccountRateLimits(),
        (response) => (response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available"),
      ),
    );
  }

  probes.push(
    probeCapability(
      host,
      "hooks/list",
      () => client.listHooks(host.vaultPath),
      (response) => {
        const count = response.data.reduce((total, entry) => total + entry.hooks.length, 0);
        return `${String(count)} hooks`;
      },
    ),
    probeCapability(
      host,
      "mcpServerStatus/list",
      () => client.listMcpServerStatus(mcpServerStatusParams(host.stateStore.getState().activeThread.id)),
      (response) => {
        recordMcpServerStatus(host, response.data);
        const issueCount = response.data.filter((server) => server.authStatus === "notLoggedIn").length;
        return issueCount > 0
          ? `${String(response.data.length)} servers, ${String(issueCount)} auth issues`
          : `${String(response.data.length)} servers`;
      },
    ),
    probeCapability(
      host,
      "collaborationMode/list",
      () => client.listCollaborationModes(),
      (response) => `${String(response.data.length)} modes`,
    ),
    probeCapability(
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

async function refreshPublishedCapabilityDiagnostics(
  host: ChatAppServerDiagnosticsActionsHost,
  options: RefreshCapabilityDiagnosticsOptions = {},
): Promise<void> {
  await refreshCapabilityDiagnostics(host, options);
  host.publishAppServerMetadata(host.appServerMetadataSnapshot());
}

async function mcpStatusLines(host: ChatAppServerDiagnosticsActionsHost): Promise<string[]> {
  const client = host.currentClient();
  if (!client) return ["MCP servers", "Codex app-server is not connected."];

  try {
    const state = host.stateStore.getState();
    const response = await client.listMcpServerStatus(mcpServerStatusParams(state.activeThread.id));
    return buildMcpStatusLines(response.data, state.connection.appServerDiagnostics.mcpServers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ["MCP servers", `Could not load MCP servers: ${message}`];
  }
}

function recordMcpStartupStatus(
  host: ChatAppServerDiagnosticsActionsHost,
  name: string,
  startupStatus: "starting" | "ready" | "failed" | "cancelled",
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

async function probeCapability<T>(
  host: ChatAppServerDiagnosticsActionsHost,
  method: CapabilityProbeMethod,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
): Promise<void> {
  try {
    const response = await request();
    const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes[method] = capabilityProbeOk(method, summarize(response));
    host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  } catch (error) {
    const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes[method] = capabilityProbeError(method, error);
    host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  }
}

function recordMcpServerStatus(host: ChatAppServerDiagnosticsActionsHost, servers: McpServerStatus[]): void {
  let diagnostics = host.stateStore.getState().connection.appServerDiagnostics;
  for (const server of servers) {
    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: server.name,
      startupStatus: "unknown",
      authStatus: server.authStatus,
      toolCount: Object.keys(server.tools).length,
      message: null,
    });
  }
  host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
}

function mcpServerStatusParams(threadId: string | null): Parameters<AppServerClient["listMcpServerStatus"]>[0] {
  return {
    detail: "toolsAndAuthOnly",
    limit: 100,
    ...(threadId ? { threadId } : {}),
  };
}

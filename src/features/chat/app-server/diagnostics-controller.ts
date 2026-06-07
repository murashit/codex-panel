import type { AppServerClient } from "../../../app-server/client";
import {
  capabilityProbeError,
  capabilityProbeOk,
  upsertMcpServerDiagnostic,
  type CapabilityProbeMethod,
} from "../../../app-server/compatibility";
import type { McpServerStatus } from "../../../generated/app-server/v2/McpServerStatus";
import type { SharedAppServerMetadata } from "../../../runtime/shared-app-server-state";
import { mcpStatusLines as buildMcpStatusLines } from "../mcp-status";
import { cloneAppServerDiagnostics, type ChatAppServerBaseHost } from "./shared";

export interface RefreshCapabilityDiagnosticsOptions {
  cachedAppServerMetadata?: boolean;
}

export interface ChatAppServerDiagnosticsControllerHost extends ChatAppServerBaseHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  appServerMetadataSnapshot: () => SharedAppServerMetadata;
}

export class ChatAppServerDiagnosticsController {
  constructor(private readonly host: ChatAppServerDiagnosticsControllerHost) {}

  async refreshCapabilityDiagnostics(options: RefreshCapabilityDiagnosticsOptions = {}): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;

    const probes: Promise<void>[] = [];
    if (!options.cachedAppServerMetadata) {
      probes.push(
        this.probeCapability(
          "model/list",
          () => client.listModels(false),
          (response) => `${String(response.data.length)} models`,
        ),
        this.probeCapability(
          "skills/list",
          () => client.listSkills(this.host.vaultPath),
          (response) => {
            const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
            return `${String(count)} skills`;
          },
        ),
        this.probeCapability(
          "account/rateLimits/read",
          () => client.readAccountRateLimits(),
          (response) => (response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available"),
        ),
      );
    }

    probes.push(
      this.probeCapability(
        "hooks/list",
        () => client.listHooks(this.host.vaultPath),
        (response) => {
          const count = response.data.reduce((total, entry) => total + entry.hooks.length, 0);
          return `${String(count)} hooks`;
        },
      ),
      this.probeCapability(
        "mcpServerStatus/list",
        () => client.listMcpServerStatus(mcpServerStatusParams(this.host.stateStore.getState().activeThread.id)),
        (response) => {
          this.recordMcpServerStatus(response.data);
          const issueCount = response.data.filter((server) => server.authStatus === "notLoggedIn").length;
          return issueCount > 0
            ? `${String(response.data.length)} servers, ${String(issueCount)} auth issues`
            : `${String(response.data.length)} servers`;
        },
      ),
      this.probeCapability(
        "collaborationMode/list",
        () => client.listCollaborationModes(),
        (response) => `${String(response.data.length)} modes`,
      ),
      this.probeCapability(
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

  async refreshPublishedCapabilityDiagnostics(options: RefreshCapabilityDiagnosticsOptions = {}): Promise<void> {
    await this.refreshCapabilityDiagnostics(options);
    this.host.publishAppServerMetadata(this.host.appServerMetadataSnapshot());
  }

  async mcpStatusLines(): Promise<string[]> {
    const client = this.host.currentClient();
    if (!client) return ["MCP servers", "Codex app-server is not connected."];

    try {
      const state = this.host.stateStore.getState();
      const response = await client.listMcpServerStatus(mcpServerStatusParams(state.activeThread.id));
      return buildMcpStatusLines(response.data, state.connection.appServerDiagnostics.mcpServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return ["MCP servers", `Could not load MCP servers: ${message}`];
    }
  }

  recordMcpStartupStatus(name: string, startupStatus: "starting" | "ready" | "failed" | "cancelled", message: string | null): void {
    this.host.stateStore.dispatch({
      type: "connection/metadata-applied",
      appServerDiagnostics: upsertMcpServerDiagnostic(this.host.stateStore.getState().connection.appServerDiagnostics, {
        name,
        startupStatus,
        authStatus: null,
        toolCount: null,
        message,
      }),
    });
  }

  private async probeCapability<T>(
    method: CapabilityProbeMethod,
    request: () => Promise<T>,
    summarize: (response: T) => string | null,
  ): Promise<void> {
    try {
      const response = await request();
      const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
      diagnostics.probes[method] = capabilityProbeOk(method, summarize(response));
      this.host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
    } catch (error) {
      const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
      diagnostics.probes[method] = capabilityProbeError(method, error);
      this.host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
    }
  }

  private recordMcpServerStatus(servers: McpServerStatus[]): void {
    let diagnostics = this.host.stateStore.getState().connection.appServerDiagnostics;
    for (const server of servers) {
      diagnostics = upsertMcpServerDiagnostic(diagnostics, {
        name: server.name,
        startupStatus: "unknown",
        authStatus: server.authStatus,
        toolCount: Object.keys(server.tools).length,
        message: null,
      });
    }
    this.host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
  }
}

function mcpServerStatusParams(threadId: string | null): Parameters<AppServerClient["listMcpServerStatus"]>[0] {
  return {
    detail: "toolsAndAuthOnly",
    limit: 100,
    ...(threadId ? { threadId } : {}),
  };
}

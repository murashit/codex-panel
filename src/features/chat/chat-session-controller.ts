import type { AppServerClient } from "../../app-server/client";
import {
  capabilityProbeError,
  capabilityProbeOk,
  upsertMcpServerDiagnostic,
  type CapabilityProbeMethod,
} from "../../app-server/compatibility";
import { reportedServiceTier } from "../../app-server/service-tier";
import type { McpServerStatus } from "../../generated/app-server/v2/McpServerStatus";
import { requestedOrConfiguredServiceTier, type RuntimeSnapshot } from "../../runtime/state";
import type { ChatState } from "./chat-state";

export interface ChatSessionControllerHost {
  state: ChatState;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  forceMessagesToBottom: () => void;
}

export interface RefreshCapabilityDiagnosticsOptions {
  cachedSessionMetadata?: boolean;
}

export class ChatSessionController {
  constructor(private readonly host: ChatSessionControllerHost) {}

  async refreshThreadList(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    const response = await client.listThreads(this.host.vaultPath);
    this.host.state.listedThreads = response.data;
    this.host.state.threadsLoaded = true;
  }

  async refreshSessionMetadata(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    this.host.state.effectiveConfig = await client.readEffectiveConfig(this.host.vaultPath);
    await Promise.all([this.refreshModels(), this.refreshSkills(), this.refreshRateLimits()]);
  }

  async startThread(): Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const serviceTier = requestedOrConfiguredServiceTier(this.host.runtimeSnapshot());
    const response = await client.startThread(this.host.vaultPath, serviceTier);
    this.host.state.activeThreadId = response.thread.id;
    this.host.state.activeThreadCwd = response.cwd;
    this.host.state.activeTurnId = null;
    this.host.state.activeModel = response.model;
    this.host.state.activeReasoningEffort = response.reasoningEffort;
    this.host.state.activeServiceTier = reportedServiceTier(response.serviceTier);
    this.host.state.activeApprovalsReviewer = response.approvalsReviewer;
    this.host.state.activeThreadCliVersion = response.thread.cliVersion;
    this.host.state.tokenUsage = null;
    this.host.state.historyCursor = null;
    this.host.state.turnDiffs.clear();
    this.host.forceMessagesToBottom();
    return response;
  }

  async refreshModels(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.listModels(false);
      this.host.state.availableModels = response.data;
      this.host.state.appServerDiagnostics.probes["model/list"] = capabilityProbeOk("model/list", `${String(response.data.length)} models`);
    } catch (error) {
      this.host.state.availableModels = [];
      this.host.state.appServerDiagnostics.probes["model/list"] = capabilityProbeError("model/list", error);
    }
  }

  async refreshSkills(forceReload = false): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.listSkills(this.host.vaultPath, forceReload);
      this.host.state.availableSkills = response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
      const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
      this.host.state.appServerDiagnostics.probes["skills/list"] = capabilityProbeOk("skills/list", `${String(count)} skills`);
    } catch (error) {
      this.host.state.availableSkills = [];
      this.host.state.appServerDiagnostics.probes["skills/list"] = capabilityProbeError("skills/list", error);
    }
  }

  async refreshRateLimits(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.readAccountRateLimits();
      const rateLimitsByLimitId = response.rateLimitsByLimitId;
      const codexRateLimit = rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, "codex") ? rateLimitsByLimitId["codex"] : undefined;
      this.host.state.rateLimit = codexRateLimit ?? response.rateLimits;
      this.host.state.appServerDiagnostics.probes["account/rateLimits/read"] = capabilityProbeOk(
        "account/rateLimits/read",
        response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available",
      );
    } catch (error) {
      this.host.state.rateLimit = null;
      this.host.state.appServerDiagnostics.probes["account/rateLimits/read"] = capabilityProbeError("account/rateLimits/read", error);
    }
  }

  async refreshCapabilityDiagnostics(options: RefreshCapabilityDiagnosticsOptions = {}): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;

    const probes: Promise<void>[] = [];
    if (!options.cachedSessionMetadata) {
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
        () => client.listMcpServerStatus(),
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

  recordMcpStartupStatus(name: string, startupStatus: "starting" | "ready" | "failed" | "cancelled", message: string | null): void {
    this.host.state.appServerDiagnostics = upsertMcpServerDiagnostic(this.host.state.appServerDiagnostics, {
      name,
      startupStatus,
      authStatus: null,
      toolCount: null,
      message,
    });
  }

  private async probeCapability<T>(
    method: CapabilityProbeMethod,
    request: () => Promise<T>,
    summarize: (response: T) => string | null,
  ): Promise<void> {
    try {
      const response = await request();
      this.host.state.appServerDiagnostics.probes[method] = capabilityProbeOk(method, summarize(response));
    } catch (error) {
      this.host.state.appServerDiagnostics.probes[method] = capabilityProbeError(method, error);
    }
  }

  private recordMcpServerStatus(servers: McpServerStatus[]): void {
    for (const server of servers) {
      this.host.state.appServerDiagnostics = upsertMcpServerDiagnostic(this.host.state.appServerDiagnostics, {
        name: server.name,
        startupStatus: "unknown",
        authStatus: server.authStatus,
        toolCount: Object.keys(server.tools).length,
        message: null,
      });
    }
  }
}

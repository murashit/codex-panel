import type { AppServerClient } from "../../app-server/client";
import {
  type AppServerDiagnostics,
  capabilityProbeError,
  capabilityProbeOk,
  upsertMcpServerDiagnostic,
  type CapabilityProbeMethod,
} from "../../app-server/compatibility";
import { reportedServiceTier } from "../../app-server/service-tier";
import type { McpServerStatus } from "../../generated/app-server/v2/McpServerStatus";
import type { Model } from "../../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../generated/app-server/v2/SkillMetadata";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import { requestedOrConfiguredServiceTier, type RuntimeSnapshot } from "../../runtime/state";
import type { ChatAction, ChatState, ChatStateStore } from "./chat-state";

export interface ChatAppServerControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  forceMessagesToBottom: () => void;
}

export interface RefreshCapabilityDiagnosticsOptions {
  cachedAppServerMetadata?: boolean;
}

export class ChatAppServerController {
  constructor(private readonly host: ChatAppServerControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  applyThreadList(threads: ChatState["listedThreads"]): void {
    this.dispatch({ type: "thread/list-applied", threads, threadsLoaded: true });
  }

  async loadThreadList(): Promise<ChatState["listedThreads"]> {
    const client = this.host.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const response = await client.listThreads(this.host.vaultPath);
    return response.data;
  }

  appServerMetadataSnapshot(): SharedAppServerMetadata {
    return {
      effectiveConfig: this.state.effectiveConfig,
      availableModels: this.state.availableModels,
      availableSkills: this.state.availableSkills,
      rateLimit: this.state.rateLimit,
      appServerDiagnostics: this.state.appServerDiagnostics,
    };
  }

  applyAppServerMetadata(metadata: SharedAppServerMetadata): void {
    this.dispatch({
      type: "thread/list-applied",
      effectiveConfig: metadata.effectiveConfig,
      availableModels: metadata.availableModels,
      availableSkills: metadata.availableSkills,
      rateLimit: metadata.rateLimit,
      appServerDiagnostics: metadata.appServerDiagnostics,
    });
  }

  async loadAppServerMetadata(): Promise<SharedAppServerMetadata | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const effectiveConfig = await client.readEffectiveConfig(this.host.vaultPath);
    const [models, skills, rateLimit] = await Promise.all([this.loadModels(), this.loadSkills(), this.loadRateLimit()]);
    const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
    diagnostics.probes["model/list"] = models.probe;
    diagnostics.probes["skills/list"] = skills.probe;
    diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
    return {
      effectiveConfig,
      availableModels: models.data,
      availableSkills: skills.data,
      rateLimit: rateLimit.data,
      appServerDiagnostics: diagnostics,
    };
  }

  async refreshAppServerMetadata(): Promise<SharedAppServerMetadata | null> {
    const metadata = await this.loadAppServerMetadata();
    if (metadata) this.applyAppServerMetadata(metadata);
    return metadata;
  }

  async startThread(): Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const serviceTier = requestedOrConfiguredServiceTier(this.host.runtimeSnapshot());
    const response = await client.startThread(this.host.vaultPath, serviceTier);
    this.dispatch({
      type: "thread/resumed",
      thread: response.thread,
      cwd: response.cwd,
      model: response.model,
      reasoningEffort: response.reasoningEffort,
      serviceTier: reportedServiceTier(response.serviceTier),
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      activePermissionProfile: response.activePermissionProfile,
      forceMessagesToBottom: true,
    });
    this.host.forceMessagesToBottom();
    return response;
  }

  async refreshModels(): Promise<void> {
    const models = await this.loadModels();
    const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
    diagnostics.probes["model/list"] = models.probe;
    this.dispatch({ type: "thread/list-applied", availableModels: models.data, appServerDiagnostics: diagnostics });
  }

  async loadModels(): Promise<{ data: Model[]; probe: AppServerDiagnostics["probes"]["model/list"] }> {
    const client = this.host.currentClient();
    if (!client) return { data: [], probe: capabilityProbeError("model/list", new Error("Codex app-server is not connected.")) };
    try {
      const response = await client.listModels(false);
      return { data: response.data, probe: capabilityProbeOk("model/list", `${String(response.data.length)} models`) };
    } catch (error) {
      return { data: [], probe: capabilityProbeError("model/list", error) };
    }
  }

  async refreshSkills(forceReload = false): Promise<void> {
    const skills = await this.loadSkills(forceReload);
    const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
    diagnostics.probes["skills/list"] = skills.probe;
    this.dispatch({ type: "thread/list-applied", availableSkills: skills.data, appServerDiagnostics: diagnostics });
  }

  async loadSkills(forceReload = false): Promise<{ data: SkillMetadata[]; probe: AppServerDiagnostics["probes"]["skills/list"] }> {
    const client = this.host.currentClient();
    if (!client) return { data: [], probe: capabilityProbeError("skills/list", new Error("Codex app-server is not connected.")) };
    try {
      const response = await client.listSkills(this.host.vaultPath, forceReload);
      const data = response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
      const count = response.data.reduce((total, entry) => total + entry.skills.length, 0);
      return { data, probe: capabilityProbeOk("skills/list", `${String(count)} skills`) };
    } catch (error) {
      return { data: [], probe: capabilityProbeError("skills/list", error) };
    }
  }

  async refreshRateLimits(): Promise<void> {
    const rateLimit = await this.loadRateLimit();
    const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
    diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
    this.dispatch({ type: "thread/list-applied", rateLimit: rateLimit.data, appServerDiagnostics: diagnostics });
  }

  async loadRateLimit(): Promise<{ data: RateLimitSnapshot | null; probe: AppServerDiagnostics["probes"]["account/rateLimits/read"] }> {
    const client = this.host.currentClient();
    if (!client) {
      return {
        data: null,
        probe: capabilityProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
      };
    }
    try {
      const response = await client.readAccountRateLimits();
      const rateLimitsByLimitId = response.rateLimitsByLimitId;
      const codexRateLimit = rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, "codex") ? rateLimitsByLimitId["codex"] : undefined;
      return {
        data: codexRateLimit ?? response.rateLimits,
        probe: capabilityProbeOk(
          "account/rateLimits/read",
          response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available",
        ),
      };
    } catch (error) {
      return { data: null, probe: capabilityProbeError("account/rateLimits/read", error) };
    }
  }

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
    this.dispatch({
      type: "thread/list-applied",
      appServerDiagnostics: upsertMcpServerDiagnostic(this.state.appServerDiagnostics, {
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
      const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
      diagnostics.probes[method] = capabilityProbeOk(method, summarize(response));
      this.dispatch({ type: "thread/list-applied", appServerDiagnostics: diagnostics });
    } catch (error) {
      const diagnostics = cloneAppServerDiagnostics(this.state.appServerDiagnostics);
      diagnostics.probes[method] = capabilityProbeError(method, error);
      this.dispatch({ type: "thread/list-applied", appServerDiagnostics: diagnostics });
    }
  }

  private recordMcpServerStatus(servers: McpServerStatus[]): void {
    let diagnostics = this.state.appServerDiagnostics;
    for (const server of servers) {
      diagnostics = upsertMcpServerDiagnostic(diagnostics, {
        name: server.name,
        startupStatus: "unknown",
        authStatus: server.authStatus,
        toolCount: Object.keys(server.tools).length,
        message: null,
      });
    }
    this.dispatch({ type: "thread/list-applied", appServerDiagnostics: diagnostics });
  }
}

function cloneAppServerDiagnostics(diagnostics: AppServerDiagnostics): AppServerDiagnostics {
  return {
    probes: { ...diagnostics.probes },
    mcpServers: diagnostics.mcpServers.map((server) => ({ ...server })),
  };
}

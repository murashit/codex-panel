import { type AppServerDiagnostics, capabilityProbeError, capabilityProbeOk } from "../../../app-server/compatibility";
import type { Model } from "../../../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../../../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../../generated/app-server/v2/SkillMetadata";
import type { SharedAppServerMetadata } from "../../../runtime/shared-app-server-state";
import { cloneAppServerDiagnostics, type ChatAppServerBaseHost } from "./shared";

export interface ChatAppServerMetadataControllerHost extends ChatAppServerBaseHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
}

export class ChatAppServerMetadataController {
  constructor(private readonly host: ChatAppServerMetadataControllerHost) {}

  appServerMetadataSnapshot(): SharedAppServerMetadata {
    const state = this.host.stateStore.getState();
    return {
      effectiveConfig: state.connection.effectiveConfig,
      availableModels: state.connection.availableModels,
      availableSkills: state.connection.availableSkills,
      rateLimit: state.connection.rateLimit,
      appServerDiagnostics: state.connection.appServerDiagnostics,
    };
  }

  applyAppServerMetadata(metadata: SharedAppServerMetadata): void {
    this.host.stateStore.dispatch({
      type: "connection/metadata-applied",
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
    const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
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

  async refreshPublishedAppServerMetadata(): Promise<SharedAppServerMetadata | null> {
    const metadata = await this.refreshAppServerMetadata();
    if (metadata) this.host.publishAppServerMetadata(metadata);
    return metadata;
  }

  publishAppServerMetadataSnapshot(): void {
    this.host.publishAppServerMetadata(this.appServerMetadataSnapshot());
  }

  async refreshModels(): Promise<void> {
    const models = await this.loadModels();
    const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes["model/list"] = models.probe;
    this.host.stateStore.dispatch({
      type: "connection/metadata-applied",
      availableModels: models.data,
      appServerDiagnostics: diagnostics,
    });
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
    const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes["skills/list"] = skills.probe;
    this.host.stateStore.dispatch({
      type: "connection/metadata-applied",
      availableSkills: skills.data,
      appServerDiagnostics: diagnostics,
    });
  }

  async refreshPublishedSkills(forceReload = false): Promise<void> {
    await this.refreshSkills(forceReload);
    this.publishAppServerMetadataSnapshot();
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
    const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
    this.host.stateStore.dispatch({
      type: "connection/metadata-applied",
      rateLimit: rateLimit.data,
      appServerDiagnostics: diagnostics,
    });
  }

  async refreshPublishedRateLimits(): Promise<void> {
    const rateLimit = await this.loadRateLimit();
    const diagnostics = cloneAppServerDiagnostics(this.host.stateStore.getState().connection.appServerDiagnostics);
    diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
    if (rateLimit.probe.status === "ok") {
      this.host.stateStore.dispatch({
        type: "connection/metadata-applied",
        rateLimit: rateLimit.data,
        appServerDiagnostics: diagnostics,
      });
      this.publishAppServerMetadataSnapshot();
      return;
    }
    this.host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
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
}

import type { AppServerClient } from "../app-server/client";
import { requestedOrConfiguredServiceTier, type RuntimeSnapshot } from "../runtime/state";
import type { PanelState } from "./state";

export interface PanelSessionControllerHost {
  state: PanelState;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
  addDedupedSystemMessage: (text: string) => void;
  forceMessagesToBottom: () => void;
}

export class PanelSessionController {
  constructor(private readonly host: PanelSessionControllerHost) {}

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
    await this.refreshModels();
    await this.refreshSkills();
    await this.refreshRateLimits();
  }

  async startThread(): Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const serviceTier = requestedOrConfiguredServiceTier(this.host.runtimeSnapshot());
    const response = await client.startThread(this.host.vaultPath, serviceTier);
    this.host.state.activeThreadId = response.thread.id;
    this.host.state.activeThreadCwd = response.cwd ?? response.thread.cwd ?? this.host.vaultPath;
    this.host.state.activeTurnId = null;
    this.host.state.activeModel = response.model ?? null;
    this.host.state.activeServiceTier = response.serviceTier ?? null;
    this.host.state.activeThreadCliVersion = response.thread.cliVersion ?? null;
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
      this.host.state.appServerCompatibility.modelList = "ok";
      this.host.state.appServerCompatibility.modelListError = null;
    } catch (error) {
      this.host.state.availableModels = [];
      const message = error instanceof Error ? error.message : String(error);
      this.host.state.appServerCompatibility.modelList = "failed";
      this.host.state.appServerCompatibility.modelListError = message;
      this.host.addDedupedSystemMessage(`Could not load Codex models: ${message}`);
    }
  }

  async refreshSkills(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.listSkills(this.host.vaultPath);
      this.host.state.availableSkills = response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
    } catch (error) {
      this.host.state.availableSkills = [];
      this.host.addDedupedSystemMessage(`Could not load Codex skills: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async refreshRateLimits(): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.readAccountRateLimits();
      this.host.state.rateLimit = response.rateLimitsByLimitId?.codex ?? response.rateLimits ?? null;
    } catch {
      this.host.state.rateLimit = null;
    }
  }
}
